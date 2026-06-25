import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  ApiError,
  err,
  listResponse,
  logAudit,
  ok,
  parsePaginationParams,
  requireOrg,
  withHandler,
} from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const VALID_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;

export const GET = withHandler(async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.recurringBill.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        lines: true,
      },
    }),
    prisma.recurringBill.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'AP_BILLS', action: 'create' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const body = await req.json();

  const {
    vendorId,
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

  // Validation
  if (!vendorId) throw new ApiError('vendorId is required', 400);
  if (!title) throw new ApiError('title is required', 400);
  if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
    throw new ApiError(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`, 400);
  }
  if (!startDate) throw new ApiError('startDate is required', 400);
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    throw new ApiError('At least one line is required', 400);
  }

  // Validate vendor belongs to org
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, organizationId: orgId },
    select: { id: true },
  });
  if (!vendor) throw new ApiError('Vendor not found in organization', 404);

  const parsedStartDate = new Date(startDate);
  if (Number.isNaN(parsedStartDate.getTime())) {
    throw new ApiError('Invalid startDate', 400);
  }

  const parsedEndDate = endDate ? new Date(endDate) : null;
  if (parsedEndDate && Number.isNaN(parsedEndDate.getTime())) {
    throw new ApiError('Invalid endDate', 400);
  }

  const template = await prisma.recurringBill.create({
    data: {
      organizationId: orgId,
      vendorId,
      title,
      frequency,
      dayOfMonth: dayOfMonth ?? null,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      nextRunDate: parsedStartDate,
      autoPost: autoPost ?? false,
      notes: notes || null,
      taxRate: taxRate ?? 0,
      lines: {
        create: lines.map((line: any, idx: number) => ({
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
      },
    },
    include: {
      vendor: { select: { id: true, name: true, code: true } },
      lines: true,
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'RecurringBill',
    entityId: template.id,
    action: 'CREATE',
    payload: { title: template.title, frequency: template.frequency },
  });

  return ok(template, 201);
});
