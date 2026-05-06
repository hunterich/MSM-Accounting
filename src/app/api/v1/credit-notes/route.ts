import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { resolveAccountDefaultId } from '@/lib/account-defaults';
import { postJournalEntry } from '@/lib/journal-posting';
import { toNumber } from '@/lib/money';

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

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const creditNote = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'CreditNote', 'number', 'CRN');
    const created = await tx.creditNote.create({
      data: {
        ...body,
        number,
        organizationId: orgId,
        amount: Number(body.amount) || 0,
        date: new Date(body.date),
      },
    });

    // Post DR Sales Return / CR AR for the credited amount.
    // Note: schema stores a flat `amount` without explicit tax breakdown,
    // so this posting does not split out the tax-reversal line. If a tax
    // sub-amount is needed for compliance, the credit-note schema needs
    // a `taxAmount` field first.
    const amount = toNumber(created.amount);
    if (amount > 0) {
      const accounts = await tx.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
      });
      const returnAccountId =
        created.returnAccountId
        ?? resolveAccountDefaultId(accounts, undefined, 'arReturn');
      const arAccountId =
        created.arAccountId
        ?? resolveAccountDefaultId(accounts, undefined, 'arControl');

      if (returnAccountId && arAccountId) {
        await postJournalEntry(tx, {
          organizationId: orgId,
          date: new Date(created.date),
          memo: `Credit note: ${created.number}`,
          lines: [
            {
              accountId: returnAccountId,
              description: `Sales return - ${created.number}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: arAccountId,
              description: `AR reduction - ${created.number}`,
              debit: 0,
              credit: amount,
            },
          ],
        });
      }
    }

    return created;
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'CreditNote', entityId: creditNote.id, action: 'CREATE', payload: { number: creditNote.number } });
  return ok(creditNote, 201);
});
