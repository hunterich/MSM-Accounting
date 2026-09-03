import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  createInvoiceInputSchema,
  createInvoiceResponseSchema,
} from '@/types/api';
import { ApiError, logAudit, withHandler, ok, err, requireAuth, parsePaginationParams, listResponse, validateForeignKey } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { toNumber } from '@/lib/money';
import { calculateInvoiceTotals } from '@/lib/invoice-totals';
import { nextInvoiceNumber } from '@/lib/invoice-number';
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

const parseIsoDate = (value: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  return date;
};

export const POST = withPermission({ module: 'AR_INVOICES', action: 'create' }, async (request: NextRequest) => {
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
    return err(parsedPayload.error.issues[0]?.message || 'Invalid invoice payload', 400);
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

    // Tenant isolation: the customer and every referenced line item must belong
    // to this org. Without these checks a caller could attach another org's
    // customer/item, which then leaks back through the GET `include` joins.
    await validateForeignKey(
      tx.customer,
      { id: payload.customerId, organizationId: payload.organizationId },
      'Customer not found in organization',
    );
    const lineItemIds = Array.from(
      new Set(payload.lines.map((l) => l.itemId).filter((id): id is string => !!id)),
    );
    for (const itemId of lineItemIds) {
      await validateForeignKey(
        tx.item,
        { id: itemId, organizationId: payload.organizationId },
        'Item not found in organization',
      );
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

    // "Manual" on the form sends the typed number; "Auto" sends an empty one
    // and the server allocates per Settings → Document numbering, scoped to
    // the issue date's period. A manual duplicate fails with 409 on `number`.
    const manualNumber = payload.number?.trim();
    const number = manualNumber || await nextInvoiceNumber(tx, payload.organizationId, { issueDate: new Date(payload.issueDate) });

    const invoice = await tx.salesInvoice.create({
      data: {
        organizationId: payload.organizationId,
        createdById: userId,
        number,
        customerId: payload.customerId,
        invoiceType: payload.invoiceType,
        salesTypeId: payload.salesTypeId || null,
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
