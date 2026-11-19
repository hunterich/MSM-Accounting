import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { reportDate } from '@/lib/subledger-history';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

// Positive whitelist of LIVE invoice statuses (matches reports/sales and
// reports/ar). A loose `not: VOID` filter would leak held (PENDING_APPROVAL) and
// DRAFT invoices into revenue, disagreeing with the GL-based P&L.
const POSTED_STATUSES = ['SENT', 'OVERDUE', 'PAID'] as const;

/**
 * Sales-by-Type report: revenue grouped by the invoice's sales type
 * (channel/tipe penjualan). Invoices with no sales type roll up into an
 * `Untagged` bucket (id: null). Scoped to posted invoices in the [from, to]
 * issueDate window.
 */
export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);

  // `from`/`to` are YYYY-MM-DD Jakarta business days (reportDate), like every
  // other report; `to` is inclusive to the end of that day. Omitted = open.
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  let from: Date | undefined, to: Date | undefined;
  try {
    from = fromParam ? reportDate(fromParam, false) : undefined;
    to = toParam ? reportDate(toParam, true) : undefined;
  } catch { return err('Invalid report date', 400); }
  if (from && to && from > to) return err('from must be before or equal to to', 400);
  const issueDate = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

  const rows = await prisma.salesInvoice.groupBy({
    by: ['salesTypeId'],
    where: {
      organizationId: orgId,
      status: { in: [...POSTED_STATUSES] },
      ...(issueDate ? { issueDate } : {}),
    },
    _sum: { totalAmount: true, taxAmount: true },
    _count: { _all: true },
  });

  const types = await prisma.salesType.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, channel: true },
  });
  const typeById = new Map(types.map((t) => [t.id, t]));

  const data = rows.map((row) => {
    const gross = Number(row._sum.totalAmount ?? 0);
    const tax = Number(row._sum.taxAmount ?? 0);
    const type = row.salesTypeId ? typeById.get(row.salesTypeId) : null;
    return {
      id: row.salesTypeId ?? null,
      name: type?.name ?? (row.salesTypeId ? 'Unknown' : 'Untagged'),
      channel: type?.channel ?? null,
      count: row._count._all,
      gross,
      netPreTax: gross - tax,
    };
  });

  return ok({ data, from: from ?? null, to: to ?? null });
});
