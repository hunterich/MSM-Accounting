import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrg, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';

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

  // `from`/`to` are YYYY-MM-DD (or any Date-parseable string). `to` is inclusive
  // to end-of-day, mirroring reports/sales' dateTo handling.
  const from = new Date(searchParams.get('from') || '1970-01-01');
  const to = new Date(searchParams.get('to') || '2999-12-31');
  to.setHours(23, 59, 59, 999);

  const rows = await prisma.salesInvoice.groupBy({
    by: ['salesTypeId'],
    where: {
      organizationId: orgId,
      status: { in: [...POSTED_STATUSES] },
      issueDate: { gte: from, lte: to },
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

  return ok({ data, from, to });
});
