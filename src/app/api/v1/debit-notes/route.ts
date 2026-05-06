import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { postJournalEntry } from '@/lib/journal-posting';
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

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const debitNote = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'DebitNote', 'number', 'DBN');
    const created = await tx.debitNote.create({
      data: {
        ...body,
        number,
        organizationId: orgId,
        amount: asMoney(toNumber(body.amount)),
        date: new Date(body.date),
      },
    });

    // Post DR AP / CR Purchase Return for the debited amount.
    // Note: schema stores a flat `amount` without explicit tax breakdown.
    const amount = toNumber(created.amount);
    if (amount > 0) {
      const accounts = await tx.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
      });
      const settings = await loadOrgAccountDefaults(tx, orgId);
      const apAccountId =
        created.apAccountId
        ?? resolveAccountDefaultId(accounts, settings, 'apControl');
      const returnAccountId =
        created.returnAccountId
        ?? resolveAccountDefaultId(accounts, settings, 'apReturn');

      if (apAccountId && returnAccountId) {
        await postJournalEntry(tx, {
          organizationId: orgId,
          date: new Date(created.date),
          memo: `Debit note: ${created.number}`,
          lines: [
            {
              accountId: apAccountId,
              description: `AP reduction - ${created.number}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: returnAccountId,
              description: `Purchase return - ${created.number}`,
              debit: 0,
              credit: amount,
            },
          ],
        });
      }
    }

    return created;
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: debitNote.id, action: 'CREATE', payload: { number: debitNote.number } });
  return ok(debitNote, 201);
});
