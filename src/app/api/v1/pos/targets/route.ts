import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { putPosTargetsSchema } from '@/types/api';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

/** List active staff for the org and each one's target for the month. */
export const GET = withPermission({ module: 'POS_REPORTS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return err('month=YYYY-MM is required', 400);

  const employees = await prisma.employee.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const targetRows = await prisma.posSalesTarget.findMany({
    where: { organizationId: orgId, month },
    select: { employeeId: true, targetAmount: true },
  });
  const byEmp = new Map(targetRows.map((t) => [t.employeeId, Number(t.targetAmount)]));

  return ok({
    month,
    targets: employees.map((e) => ({ employeeId: e.id, name: e.name, targetAmount: byEmp.get(e.id) ?? null })),
  });
});

/** Bulk upsert targets for a month. A null/zero amount clears the row. */
export const PUT = withPermission({ module: 'POS_REPORTS', action: 'edit' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const parsed = putPosTargetsSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid targets payload', 400);
  const { month, targets } = parsed.data;

  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      // Fail-closed: ignore ids that are not this org's employees.
      const emp = await tx.employee.findFirst({ where: { id: t.employeeId, organizationId: orgId }, select: { id: true } });
      if (!emp) continue;
      if (t.targetAmount == null || t.targetAmount <= 0) {
        await tx.posSalesTarget.deleteMany({ where: { organizationId: orgId, employeeId: t.employeeId, month } });
      } else {
        await tx.posSalesTarget.upsert({
          where: { organizationId_employeeId_month: { organizationId: orgId, employeeId: t.employeeId, month } },
          update: { targetAmount: t.targetAmount },
          create: { organizationId: orgId, employeeId: t.employeeId, month, targetAmount: t.targetAmount },
        });
      }
    }
  });
  return ok({ ok: true });
});
