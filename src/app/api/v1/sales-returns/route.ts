import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';

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
  const body = await req.json();
  const { lines, ...header } = body;

  const salesReturn = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'SalesReturn', 'number', 'SRN');
    return tx.salesReturn.create({
      data: {
        ...header,
        number,
        organizationId: orgId,
        returnDate: new Date(header.returnDate),
        subtotal:    Number(header.subtotal    ?? 0),
        taxAmount:   Number(header.taxAmount   ?? 0),
        totalAmount: Number(header.totalAmount ?? 0),
        taxRate:     Number(header.taxRate     ?? 11),
        lines: lines?.length ? {
          create: lines.map((l: any, idx: number) => ({
            lineNo:   idx + 1,
            itemId:   l.itemId || null,
            itemName: l.itemName || l.description || '',
            qtySold:  Number(l.qtySold ?? 0),
            qtyReturn: Number(l.qtyReturn ?? 0),
            unit:     l.unit || 'PCS',
            price:    Number(l.price ?? 0),
            lineTotal: Number(l.lineTotal ?? l.qtyReturn * l.price),
          })),
        } : undefined,
      },
      include: { lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: salesReturn.id, action: 'CREATE', payload: { number: salesReturn.number } });
  return ok(salesReturn, 201);
});
