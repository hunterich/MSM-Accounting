import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { createBankAccountInputSchema } from '@/types/api';
import { postBankOpeningBalance } from '@/lib/bank-transaction-posting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);
  const isActive = searchParams.get('isActive');
  const data = await prisma.bankAccount.findMany({
    where: { organizationId: orgId, isActive: isActive ? isActive === 'true' : true },
    orderBy: { name: 'asc' },
    include: { _count: { select: { transactions: true } } },
  });
  return ok(data);
});

export const POST = withPermission({ module: 'BANKING', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = createBankAccountInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid bank account payload', 400);
  const { openingBalance, ...rest } = parsed.data;
  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.bankAccount.create({
      data: {
        ...rest,
        openingBalance,
        currentBalance: openingBalance,
        organizationId: orgId,
      },
    });
    // Onboard the opening balance to the GL (Dr Bank / Cr Opening Balance Equity)
    // so the bank GL account reflects it — the cached currentBalance above and
    // the ledger stay in lockstep. No-op for a zero opening balance.
    await postBankOpeningBalance(tx, orgId, created.id, openingBalance, new Date());
    return created;
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankAccount', entityId: account.id, action: 'CREATE', payload: { name: account.name } });
  return ok(account, 201);
});
