import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
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

// POST creates a DRAFT debit note. The GL posting (DR AP / CR Purchase-Return)
// is deferred to the DRAFT → APPLIED transition handled in `[id]/route.ts`,
// so an unapproved draft never hits the ledger. Any client-supplied status
// is ignored — applying happens through the PUT handler only.
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
        amount: asMoney(toNumber(body.amount)),
        taxAmount: asMoney(toNumber(body.taxAmount ?? 0)),
        date: new Date(body.date),
        status: 'DRAFT',
      },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: debitNote.id, action: 'CREATE', payload: { number: debitNote.number } });
  return ok(debitNote, 201);
});
