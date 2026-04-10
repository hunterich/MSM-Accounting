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
    prisma.debitNote.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { date: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        purchaseReturn: { select: { id: true, number: true } },
        sourceBill: { select: { id: true, number: true } },
      },
    }),
    prisma.debitNote.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const debitNote = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'DebitNote', 'number', 'DBN');
    return tx.debitNote.create({
      data: {
        ...body,
        number,
        organizationId: orgId,
        amount: Number(body.amount) || 0,
        date: new Date(body.date),
      },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: debitNote.id, action: 'CREATE', payload: { number: debitNote.number } });
  return ok(debitNote, 201);
});
