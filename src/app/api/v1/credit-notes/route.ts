import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
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
    prisma.creditNote.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { date: 'desc' },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        salesReturn: { select: { id: true, number: true } },
        sourceInvoice: { select: { id: true, number: true } },
      },
    }),
    prisma.creditNote.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

// POST creates a DRAFT credit note. The GL posting (DR Sales-Return / CR AR)
// is deferred to the DRAFT → APPLIED transition handled in `[id]/route.ts`,
// so an unapproved draft never hits the ledger. Any client-supplied status
// is ignored — applying happens through the PUT handler only.
export const POST = withPermission({ module: 'AR_CREDITS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const creditNote = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'CreditNote', 'number', 'CRN');
    return tx.creditNote.create({
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

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'CreditNote', entityId: creditNote.id, action: 'CREATE', payload: { number: creditNote.number } });
  return ok(creditNote, 201);
});
