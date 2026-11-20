import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, requireOrg } from '@/lib/api-utils';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from '@/lib/account-defaults';
import { corsPreflightResponse } from '@/lib/cors';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const GET = withPermission({ module: 'INV_ADJ', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const [accounts, settings] = await Promise.all([
    prisma.account.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true } }),
    loadOrgAccountDefaults(prisma, orgId),
  ]);
  return ok({ accountId: resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') || resolveAccountDefaultId(accounts, settings, 'cogsExpense') });
});
