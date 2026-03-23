// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, listResponse, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const data = await prisma.bankAccount.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { transactions: true } } },
  });
  return ok(data);
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const account = await prisma.bankAccount.create({
    data: { ...body, organizationId: orgId },
  });
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'BankAccount', entityId: account.id, action: 'CREATE', payload: { name: body.name } });
  return ok(account, 201);
}
