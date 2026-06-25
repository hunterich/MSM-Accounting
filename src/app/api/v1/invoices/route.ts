import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  createInvoiceInputSchema,
  createInvoiceResponseSchema,
} from '@/types/api';
import { ApiError, logAudit, withHandler, ok, err, requireAuth, parsePaginationParams, listResponse } from '@/lib/api-utils';
import { toNumber, asMoney } from '@/lib/money';
import { enforceCustomerCreditLimit } from '@/lib/credit-limit';
import { applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async (req: NextRequest) => {
  const { orgId, userId } = requireAuth(req);

  const { searchParams, page, limit } = parsePaginationParams(req);
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const customerId = searchParams.get('customerId');

  const access = await getInvoiceAccessContext(orgId, userId);
  const where: any = applyInvoiceAccessScope({ organizationId: orgId, deletedAt: null }, access);
  if (status) where.status = status;
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { customer: { name: { contains: search, mode: 'insensitive' } } },
  ];
  if (dateFrom || dateTo) {
    where.issueDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
    };
  }
  if (customerId) where.customerId = customerId;

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

  return listResponse(data, total, page, limit);
});

const INVOICE_PREFIX = 'INV';
const INVOICE_DIGITS = 6;
const INVOICE_REGEX_SOURCE = '^INV-(\\d+)$';

const parseIsoDate = (value: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  return date;
};

// FNV-1a 32-bit hash — significantly better distribution than the naive * 31 approach,
// reducing advisory lock collisions across organizations.
const hashLockKey = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash || 1;
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
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
  // $queryRaw cannot deserialize (it 500s every invoice create).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

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

  const subtotal = asMoney(normalizedLines.reduce((sum: number, line: { lineSubtotal: number }) => sum + line.lineSubtotal, 0));
  const discountPct = toNumber(payload.discountPct ?? 0);
  const discountAmount = asMoney(subtotal * (discountPct / 100));
  const discountedSubtotal = asMoney(subtotal - discountAmount);

  // Additional costs (charges): each posts to its own account on SEND. A charge
  // with taxRate > 0 is taxable and joins the PPN base. Mirrors computeTotals.
  const normalizedCharges = (payload.charges ?? []).map((charge: any, index: number) => ({
    lineNo: index + 1,
    label: charge.label,
    accountId: charge.accountId || null,
    amount: asMoney(toNumber(charge.amount)),
    taxRate: toNumber(charge.taxRate ?? 0),
  }));
  const chargesTotal = asMoney(normalizedCharges.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0));
  const taxableCharges = asMoney(
    normalizedCharges.filter((c: { taxRate: number }) => c.taxRate > 0).reduce((sum: number, c: { amount: number }) => sum + c.amount, 0),
  );

  const taxEnabled = payload.tax?.enabled ?? orgDefaults.taxEnabled;
  const taxInclusive = payload.tax?.inclusive ?? orgDefaults.taxInclusiveByDefault;
  const taxRate = toNumber(payload.tax?.rate ?? orgDefaults.taxDefaultRate);
  const rate = taxRate / 100;

  let taxAmount = 0;
  let totalAmount = asMoney(discountedSubtotal + chargesTotal);

  if (taxEnabled && taxRate > 0) {
    const taxableBase = asMoney(discountedSubtotal + taxableCharges);
    if (taxInclusive) {
      taxAmount = asMoney(taxableBase - taxableBase / (1 + rate));
      totalAmount = asMoney(discountedSubtotal + chargesTotal); // tax already inside
    } else {
      taxAmount = asMoney(taxableBase * rate);
      totalAmount = asMoney(discountedSubtotal + chargesTotal + taxAmount);
    }
  }

  return {
    lines: normalizedLines,
    charges: normalizedCharges,
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

export const POST = withHandler(async (request: NextRequest) => {
  const { orgId, userId } = requireAuth(request);

  await getInvoiceAccessContext(orgId, userId);

  const rawPayload = await request.json();
  if (rawPayload?.organizationId && rawPayload.organizationId !== orgId) {
    throw new ApiError('organizationId does not match current session', 403);
  }

  const parsedPayload = createInvoiceInputSchema.safeParse({
    ...rawPayload,
    organizationId: orgId,
  });

  if (!parsedPayload.success) {
    return err('Invalid invoice payload', 400);
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
        costingMethod: true,
      },
    });

    if (!organization) {
      throw new ApiError('Organization not found', 404);
    }

    const totals = calculateInvoiceTotals(payload, {
      taxEnabled: organization.taxEnabled,
      taxDefaultRate: organization.taxDefaultRate,
      taxInclusiveByDefault: organization.taxInclusiveByDefault,
    });

    await enforceCustomerCreditLimit(tx, {
      organizationId: payload.organizationId,
      customerId: payload.customerId,
      documentAmount: totals.totalAmount,
    });

    const number = await nextInvoiceNumber(tx, payload.organizationId);

    const invoice = await tx.salesInvoice.create({
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
        charges: totals.charges.length > 0 ? { create: totals.charges } : undefined,
      },
      select: {
        id: true,
        number: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        totalAmount: true,
        currency: true,
        lines: { select: { itemId: true, quantity: true } },
      },
    });

    // NOTE: COGS is posted when invoice transitions DRAFT → SENT (in PUT handler), not at creation time, per CPA timing requirements.

    return invoice;
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

  logAudit({ orgId, actorId: userId, entityType: 'SalesInvoice', entityId: createdInvoice.id, action: 'CREATE', payload: { number: createdInvoice.number } });
  return ok(responsePayload, 201);
});
