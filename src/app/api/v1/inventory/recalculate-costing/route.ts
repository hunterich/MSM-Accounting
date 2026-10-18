import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, logAudit } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { changeInventoryCostingMethod } from '@/lib/inventory-costing-switch';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withPermission({ module: 'SETTINGS', action: 'edit' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  if (body.newMethod !== 'FIFO' && body.newMethod !== 'WEIGHTED_AVERAGE') return err('newMethod must be FIFO or WEIGHTED_AVERAGE', 400);
  if (typeof body.effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)) return err('effectiveDate must be a business date', 400);
  const date = new Date(body.effectiveDate);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.effectiveDate) return err('effectiveDate is invalid', 400);
  const options = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const result = await prisma.$transaction(tx => changeInventoryCostingMethod(tx, orgId, body.newMethod, date, options));
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Organization', entityId: orgId,
    action: 'UPDATE', payload: { ...result, newMethod: body.newMethod, effectiveDate: body.effectiveDate } });
  return ok(result);
});
