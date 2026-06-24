import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { routeForApproval } from '@/lib/approval/engine';
import { asMoney, toNumber } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 100 });
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.salesReturn.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { returnDate: 'desc' },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        invoice: { select: { id: true, number: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    }),
    prisma.salesReturn.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);
  const body = await req.json();
  const { lines, ...header } = body;

  const salesReturn = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'SalesReturn', 'number', 'SRN');
    const created = await tx.salesReturn.create({
      data: {
        ...header,
        number,
        organizationId: orgId,
        returnDate: new Date(header.returnDate),
        subtotal:    asMoney(toNumber(header.subtotal)),
        taxAmount:   asMoney(toNumber(header.taxAmount)),
        totalAmount: asMoney(toNumber(header.totalAmount)),
        taxRate:     toNumber(header.taxRate ?? 11),
        lines: lines?.length ? {
          create: lines.map((l: any, idx: number) => {
            const qtyReturn = toNumber(l.qtyReturn);
            const price = asMoney(toNumber(l.price));
            return {
              lineNo:   idx + 1,
              itemId:   l.itemId || null,
              itemName: l.itemName || l.description || '',
              qtySold:  toNumber(l.qtySold),
              qtyReturn,
              unit:     l.unit || 'PCS',
              price,
              lineTotal: asMoney(l.lineTotal != null ? toNumber(l.lineTotal) : qtyReturn * price),
            };
          }),
        } : undefined,
      },
      include: { lines: true },
    });

    // Post inventory leg if user creates as APPROVED directly. PUT handler
    // covers DRAFT → APPROVED transitions. If the approval engine routes the
    // finalize for approval first, hold the return at PENDING_APPROVAL and post NO GL.
    if (created.status === 'APPROVED') {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'SALES_RETURN',
        documentId: created.id,
      });
      if (routed) {
        await tx.salesReturn.update({
          where: { id: created.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
      } else {
        await postSalesReturnOnApproval(tx, created.id);
      }
    }

    return tx.salesReturn.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: salesReturn.id, action: 'CREATE', payload: { number: salesReturn.number } });
  return ok(salesReturn, 201);
});
