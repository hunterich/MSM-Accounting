import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, logAudit } from '@/lib/api-utils';

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

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const account = await prisma.bankAccount.create({
    data: { ...body, organizationId: orgId },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'BankAccount', entityId: account.id, action: 'CREATE', payload: { name: body.name } });
  return ok(account, 201);
});
