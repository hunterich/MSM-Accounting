import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { wibMonthRange, computeSalesPerformance, UNASSIGNED } from '@/lib/pos/sales-performance';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const GET = withPermission({ module: 'POS_REPORTS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return err('month=YYYY-MM is required', 400);

  const { start, end, daysInMonth, daysElapsed } = wibMonthRange(month, new Date());

  // Sum each invoice line's PRE-TAX value, keyed by the credited staff member,
  // over POS sales whose soldAt falls in the WIB month. POS lines store a
  // tax-INCLUSIVE `lineSubtotal` (price is tax-inclusive), so for a tax-inclusive
  // invoice we divide out the embedded PPN to get the net the target measures.
  const sales = await prisma.posSale.findMany({
    where: { organizationId: orgId, soldAt: { gte: start, lt: end } },
    select: { salesInvoice: { select: { taxInclusive: true, taxRate: true, lines: { select: { performedById: true, lineSubtotal: true } } } } },
  });
  const soldByEmployee: Record<string, number> = {};
  for (const s of sales) {
    const inv = s.salesInvoice;
    const divisor = inv.taxInclusive ? 1 + Number(inv.taxRate) / 100 : 1;
    for (const line of inv.lines) {
      const key = line.performedById ?? UNASSIGNED;
      soldByEmployee[key] = (soldByEmployee[key] ?? 0) + Number(line.lineSubtotal) / divisor;
    }
  }

  const targetRows = await prisma.posSalesTarget.findMany({
    where: { organizationId: orgId, month },
    select: { employeeId: true, targetAmount: true },
  });
  const targets: Record<string, number> = {};
  for (const t of targetRows) targets[t.employeeId] = Number(t.targetAmount);

  const ids = new Set<string>([
    ...Object.keys(soldByEmployee).filter((k) => k !== UNASSIGNED),
    ...Object.keys(targets),
  ]);
  const employees = ids.size
    ? await prisma.employee.findMany({ where: { organizationId: orgId, id: { in: [...ids] } }, select: { id: true, name: true } })
    : [];
  const names: Record<string, string> = {};
  for (const e of employees) names[e.id] = e.name;

  const { rows, totals } = computeSalesPerformance({ soldByEmployee, targets, names, daysInMonth, daysElapsed });
  return ok({ month, rows, totals });
});
