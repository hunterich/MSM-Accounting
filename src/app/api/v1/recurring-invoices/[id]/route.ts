import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  ApiError,
  logAudit,
  ok,
  err,
  requireOrg,
  withHandler,
} from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const VALID_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;

export const GET = withHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const template = await prisma.recurringInvoice.findFirst({
    where: { id, organizationId: orgId },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      lines: true,
      generatedInvoices: {
        select: { id: true, number: true, status: true, issueDate: true },
        orderBy: { issueDate: 'desc' },
      },
    },
  });

  if (!template) throw new ApiError('Recurring invoice not found', 404);

  return ok(template);
});

export const PUT = withPermission({ module: 'AR_INVOICES', action: 'edit' }, async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;
  const body = await req.json();

  const {
    customerId,
    title,
    frequency,
    dayOfMonth,
    startDate,
    endDate,
    autoPost,
    notes,
    taxRate,
    lines,
  } = body;

  // Check existence
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, startDate: true, frequency: true, dayOfMonth: true, nextRunDate: true },
  });
  if (!existing) throw new ApiError('Recurring invoice not found', 404);

  // Validate frequency if provided
  if (frequency && !VALID_FREQUENCIES.includes(frequency)) {
    throw new ApiError(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`, 400);
  }

  // Validate customer if changing
  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      select: { id: true },
    });
    if (!customer) throw new ApiError('Customer not found in organization', 404);
  }

  // Parse dates
  const parsedStartDate = startDate ? new Date(startDate) : null;
  if (parsedStartDate && Number.isNaN(parsedStartDate.getTime())) {
    throw new ApiError('Invalid startDate', 400);
  }

  const parsedEndDate = endDate !== undefined ? (endDate ? new Date(endDate) : null) : undefined;
  if (parsedEndDate instanceof Date && Number.isNaN(parsedEndDate.getTime())) {
    throw new ApiError('Invalid endDate', 400);
  }

  // Recalculate nextRunDate if startDate or frequency changed
  let nextRunDate: Date | undefined;
  const newFrequency = frequency ?? existing.frequency;
  const newDayOfMonth = dayOfMonth !== undefined ? dayOfMonth : existing.dayOfMonth;
  if (parsedStartDate) {
    nextRunDate = parsedStartDate;
  }

  const headerData: any = {};
  if (customerId !== undefined) headerData.customerId = customerId;
  if (title !== undefined) headerData.title = title;
  if (frequency !== undefined) headerData.frequency = frequency;
  if (dayOfMonth !== undefined) headerData.dayOfMonth = dayOfMonth;
  if (parsedStartDate) headerData.startDate = parsedStartDate;
  if (parsedEndDate !== undefined) headerData.endDate = parsedEndDate;
  if (autoPost !== undefined) headerData.autoPost = autoPost;
  if (notes !== undefined) headerData.notes = notes || null;
  if (taxRate !== undefined) headerData.taxRate = taxRate;
  if (nextRunDate) headerData.nextRunDate = nextRunDate;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.recurringInvoice.update({
      where: { id, organizationId: orgId },
      data: { ...headerData, updatedAt: new Date() },
    });

    if (lines && Array.isArray(lines)) {
      await tx.recurringInvoiceLine.deleteMany({ where: { recurringId: id } });
      await tx.recurringInvoiceLine.createMany({
        data: lines.map((line: any, idx: number) => ({
          recurringId: id,
          lineNo: line.lineNo ?? idx + 1,
          itemId: line.itemId || null,
          accountId: line.accountId || null,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit || 'PCS',
          price: line.price,
          discountPct: line.discountPct ?? 0,
          taxable: line.taxable ?? true,
        })),
      });
    }

    return tx.recurringInvoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        lines: true,
        generatedInvoices: {
          select: { id: true, number: true, status: true, issueDate: true },
          orderBy: { issueDate: 'desc' },
        },
      },
    });
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'RecurringInvoice',
    entityId: id,
    action: 'UPDATE',
    payload: headerData,
  });

  return ok(updated);
});

export const DELETE = withPermission({ module: 'AR_INVOICES', action: 'delete' }, async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) throw new ApiError('Recurring invoice not found', 404);

  await prisma.recurringInvoice.update({
    where: { id, organizationId: orgId },
    data: { status: 'ENDED', updatedAt: new Date() },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'RecurringInvoice',
    entityId: id,
    action: 'DELETE',
    payload: { status: 'ENDED' },
  });

  return ok({ ended: true });
});
