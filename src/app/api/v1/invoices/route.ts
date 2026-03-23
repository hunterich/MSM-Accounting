// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import {
  createInvoiceInputSchema,
  createInvoiceResponseSchema,
} from '@/types/api';
import { logAudit } from '@/lib/api-utils';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }
    if (!userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(100, Number(searchParams.get('limit') ?? 20));
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const access = await getInvoiceAccessContext(orgId, userId);
    const where: any = applyInvoiceAccessScope({ organizationId: orgId }, access);
    if (status) where.status = status;
    if (search) where.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];

    const [data, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { issueDate: 'desc' },
        include: {
          customer: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          lines: true,
        },
      }),
      prisma.salesInvoice.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed to list invoices';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

const INVOICE_PREFIX = 'INV';
const INVOICE_DIGITS = 6;
const INVOICE_REGEX_SOURCE = '^INV-(\\d+)$';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asMoney = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const parseIsoDate = (value: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  return date;
};

const hashLockKey = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
};

const getCurrentInvoiceSequence = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<number> => {
  const rows = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("number" FROM ${INVOICE_REGEX_SOURCE}) AS INTEGER)) AS max_seq
    FROM "SalesInvoice"
    WHERE "organizationId" = ${organizationId}
      AND "number" LIKE ${`${INVOICE_PREFIX}-%`}
  `;

  return Number(rows[0]?.max_seq ?? 0);
};

const nextInvoiceNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> => {
  const lockKey = hashLockKey(`invoice-seq:${organizationId}`);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const nextSequence = (await getCurrentInvoiceSequence(tx, organizationId)) + 1;
  return `${INVOICE_PREFIX}-${String(nextSequence).padStart(INVOICE_DIGITS, '0')}`;
};

const calculateInvoiceTotals = (
  payload: any,
  orgDefaults: {
    taxEnabled: boolean;
    taxDefaultRate: unknown;
    taxInclusiveByDefault: boolean;
  },
) => {
  const normalizedLines = payload.lines.map((line: any, index: number) => {
    const quantity = toNumber(line.quantity);
    const price = toNumber(line.price);
    const discountPct = toNumber(line.discountPct ?? 0);

    const gross = asMoney(quantity * price);
    const lineDiscount = asMoney(gross * (discountPct / 100));
    const lineSubtotal = asMoney(gross - lineDiscount);

    return {
      lineNo: index + 1,
      itemId: line.itemId || null,
      code: line.code || null,
      description: line.description,
      quantity,
      unit: line.unit || 'PCS',
      price,
      discountPct,
      lineSubtotal,
    };
  });

  const subtotal = asMoney(normalizedLines.reduce((sum, line) => sum + line.lineSubtotal, 0));
  const discountPct = toNumber(payload.discountPct ?? 0);
  const discountAmount = asMoney(subtotal * (discountPct / 100));
  const discountedSubtotal = asMoney(subtotal - discountAmount);

  const taxEnabled = payload.tax?.enabled ?? orgDefaults.taxEnabled;
  const taxInclusive = payload.tax?.inclusive ?? orgDefaults.taxInclusiveByDefault;
  const taxRate = toNumber(payload.tax?.rate ?? orgDefaults.taxDefaultRate);
  const rate = taxRate / 100;

  let taxAmount = 0;
  let totalAmount = discountedSubtotal;

  if (taxEnabled && taxRate > 0) {
    if (taxInclusive) {
      taxAmount = asMoney(discountedSubtotal - discountedSubtotal / (1 + rate));
      totalAmount = discountedSubtotal;
    } else {
      taxAmount = asMoney(discountedSubtotal * rate);
      totalAmount = asMoney(discountedSubtotal + taxAmount);
    }
  }

  return {
    lines: normalizedLines,
    subtotal,
    discountPct,
    discountAmount,
    taxEnabled,
    taxInclusive,
    taxRate,
    taxAmount,
    totalAmount,
  };
};

export async function POST(request: NextRequest) {
  try {
    const orgId = request.headers.get('x-org-id');
    const userId = request.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ message: 'Unauthenticated' }, { status: 401 }));
    }
    if (!userId) {
      return withCors(NextResponse.json({ message: 'Unauthenticated' }, { status: 401 }));
    }

    await getInvoiceAccessContext(orgId, userId);

    const rawPayload = await request.json();
    if (rawPayload?.organizationId && rawPayload.organizationId !== orgId) {
      return withCors(
        NextResponse.json({ message: 'organizationId does not match current session' }, { status: 403 }),
      );
    }

    const parsedPayload = createInvoiceInputSchema.safeParse({
      ...rawPayload,
      organizationId: orgId,
    });

    if (!parsedPayload.success) {
      return withCors(NextResponse.json(
        {
          message: 'Invalid invoice payload',
          issues: parsedPayload.error.issues,
        },
        { status: 400 },
      ));
    }

    const payload = parsedPayload.data;

    const createdInvoice = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: payload.organizationId },
        select: {
          id: true,
          taxEnabled: true,
          taxDefaultRate: true,
          taxInclusiveByDefault: true,
        },
      });

      if (!organization) {
        throw new ApiError('Organization not found', 404);
      }

      const customer = await tx.customer.findFirst({
        where: {
          id: payload.customerId,
          organizationId: payload.organizationId,
        },
        select: { id: true },
      });

      if (!customer) {
        throw new ApiError('Customer not found in organization', 404);
      }

      const number = await nextInvoiceNumber(tx, payload.organizationId);
      const totals = calculateInvoiceTotals(payload, {
        taxEnabled: organization.taxEnabled,
        taxDefaultRate: organization.taxDefaultRate,
        taxInclusiveByDefault: organization.taxInclusiveByDefault,
      });

      return tx.salesInvoice.create({
        data: {
          organizationId: payload.organizationId,
          createdById: userId,
          number,
          customerId: payload.customerId,
          invoiceType: payload.invoiceType,
          issueDate: parseIsoDate(payload.issueDate),
          dueDate: payload.dueDate ? parseIsoDate(payload.dueDate) : null,
          shippingDate: payload.shippingDate ? parseIsoDate(payload.shippingDate) : null,
          poNumber: payload.poNumber || null,
          email: payload.email || null,
          billingAddress: payload.billingAddress || null,
          shippingAddress: payload.shippingAddress || null,
          currency: payload.currency,
          status: 'DRAFT',
          discountPct: totals.discountPct,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxEnabled: totals.taxEnabled,
          taxInclusive: totals.taxInclusive,
          taxRate: totals.taxRate,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          notes: payload.notes || null,
          lines: {
            create: totals.lines,
          },
        },
        select: {
          id: true,
          number: true,
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          currency: true,
        },
      });
    });

    const responsePayload = createInvoiceResponseSchema.parse({
      id: createdInvoice.id,
      number: createdInvoice.number,
      subtotal: toNumber(createdInvoice.subtotal),
      discountAmount: toNumber(createdInvoice.discountAmount),
      taxAmount: toNumber(createdInvoice.taxAmount),
      totalAmount: toNumber(createdInvoice.totalAmount),
      currency: createdInvoice.currency,
    });

    logAudit({ orgId: orgId!, actorId: request.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: createdInvoice.id, action: 'CREATE', payload: { number: createdInvoice.number } });
    return withCors(NextResponse.json(responsePayload, { status: 201 }));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ message: error.message }, { status: error.status }));
    }

    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ message: error.message }, { status: error.status }));
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return withCors(NextResponse.json(
          { message: 'Invoice number collision detected. Please retry.' },
          { status: 409 },
        ));
      }
    }

    const message = error instanceof Error ? error.message : 'Failed to create invoice';
    return withCors(NextResponse.json({ message }, { status: 500 }));
  }
}
