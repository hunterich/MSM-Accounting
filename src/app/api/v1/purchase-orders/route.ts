// PurchaseOrder: number, vendorId, date, expectedDate, status (PurchaseOrderStatus), totalAmount
// PurchaseOrderStatus: DRAFT | APPROVED | PARTIAL_RECEIVED | CLOSED | CANCELLED
// PurchaseOrderLine: purchaseOrderId, lineNo, description, quantity, unit, price, lineTotal
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, validateForeignKey, withHandler } from '@/lib/api-utils';
import { purchaseOrderInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const vendorId = searchParams.get('vendorId');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { vendor: { name: { contains: search, mode: 'insensitive' } } },
  ];
  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
    };
  }
  if (vendorId) where.vendorId = vendorId;

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { date: 'desc' },
      include: { vendor: { select: { id: true, name: true, code: true } }, lines: true },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = purchaseOrderInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid purchase order payload', 400);
  }
  const { lines, ...header } = parsed.data;
  const number = await nextNumber(prisma, 'PurchaseOrder', 'number', 'PO');

  const po = await prisma.$transaction(async (tx) => {
    await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
    const created = await tx.purchaseOrder.create({
      data: { ...header, organizationId: orgId, number },
    });
    if (lines && lines.length > 0) {
      await tx.purchaseOrderLine.createMany({
        data: lines.map((l: any, idx: number) => ({
          ...l,
          purchaseOrderId: created.id,
          lineNo: l.lineNo ?? idx + 1,
        })),
      });
    }
    return tx.purchaseOrder.findUnique({
      where: { id: created.id },
      include: { vendor: true, lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseOrder', entityId: po!.id, action: 'CREATE', payload: { number } });
  return ok(po, 201);
});
