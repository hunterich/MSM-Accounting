import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readCustomerSales, readItemSales, readTopProducts, readItemCustomerSales, readSalesCalendar } from '@/lib/sales-summary';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

// Safety bound for transaction-detail reports. Summary reports aggregate in SQL.
// These load matching
// rows and aggregate in JS; without a cap an all-time query on a large dataset
// can exhaust memory. We over-fetch by one and reject rather than silently
// truncate (a truncated set would produce wrong totals). Normal date-scoped
// reports stay well under this and are unaffected.
const ROW_CAP = 100_000;
const ROW_CAP_MSG = 'Report dataset too large — narrow the date range and try again';

export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const { searchParams } = new URL(req.url);
  const type           = searchParams.get('type') || 'by-customer';
  const dateFrom       = searchParams.get('dateFrom');
  const dateTo         = searchParams.get('dateTo');
  const customerSearch = searchParams.get('customerSearch') || '';
  const itemSearch     = searchParams.get('itemSearch') || '';
  const topNRaw        = searchParams.get('topN');
  const topN           = topNRaw ? parseInt(topNRaw, 10) : null;
  const sortBy         = searchParams.get('sortBy') || 'total'; // 'total' | 'qty'

  // Positive whitelist of LIVE invoice statuses (matches reports/ar and the
  // dashboard convention). A loose `status: { not: 'VOID' }` would leak held
  // (PENDING_APPROVAL) and DRAFT invoices into revenue totals, disagreeing with
  // the GL-based P&L (which only sums POSTED journal lines).
  const dateFilter: any = {
    organizationId: orgId,
    status: { in: ['SENT', 'OVERDUE', 'PAID'] },
  };
  if (dateFrom) dateFilter.issueDate = { ...dateFilter.issueDate, gte: new Date(dateFrom) };
  if (dateTo) {
    const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
    dateFilter.issueDate = { ...dateFilter.issueDate, lte: end };
  }

  const summaryFilter = {
    organizationId: orgId,
    dateFrom: dateFilter.issueDate?.gte,
    dateTo: dateFilter.issueDate?.lte,
  };

  /* ── Sales by Customer ── */
  if (type === 'by-customer') {
    let rows = await readCustomerSales(prisma, { ...summaryFilter, customerSearch });
    if (topN && topN > 0) rows = rows.slice(0, topN);
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Drill-down: one customer's sales per day ── */
  if (type === 'by-customer-daily') {
    const customerId = searchParams.get('customerId');
    if (!customerId) return err('customerId is required', 400);
    const rows = (await readSalesCalendar(prisma, summaryFilter, 'day', customerId))
      .map(({ bucket, ...row }) => ({ date: bucket, ...row }));
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Sales by Item ── */
  if (type === 'by-item') {
    let rows = await readItemSales(prisma, summaryFilter);
    // Apply item search filter
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      rows = rows.filter(r => r.description?.toLowerCase().includes(q));
    }
    // Sort by qty or total
    rows = rows.sort((a, b) => sortBy === 'qty' ? b.qty - a.qty : b.total - a.total);
    // Apply top N limit
    if (topN && topN > 0) rows = rows.slice(0, topN);
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Top Products (best sellers, grouped by master item) ── */
  // Like `by-item` but keyed on the master `itemId` (not free-text description),
  // so the same product always rolls up to one row. Master-only: lines without
  // an `itemId` are excluded. Used by the Best Selling Products dashboard widget.
  if (type === 'top-products') {
    let rows = await readTopProducts(prisma, summaryFilter);
    // Default ranking is by units sold (qty); `sortBy=total` ranks by revenue.
    rows = rows.sort((a, b) => sortBy === 'total' ? b.total - a.total : b.qty - a.qty);
    if (topN && topN > 0) rows = rows.slice(0, topN);
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Sales Item × Customer ── */
  if (type === 'by-item-customer') {
    let rows = await readItemCustomerSales(prisma, summaryFilter);
    if (customerSearch) {
      const q = customerSearch.toLowerCase();
      rows = rows.filter((row) => row.customerName?.toLowerCase().includes(q));
    }
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      rows = rows.filter((row) => row.description?.toLowerCase().includes(q));
    }
    rows = rows.sort((a, b) => b.total - a.total);
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Sales Return List ── */
  if (type === 'return-list') {
    // Same "live only" convention as invoices: DRAFT and VOID returns are not real yet / cancelled.
    const returnWhere: any = {
      organizationId: orgId,
      status: { in: ['APPROVED', 'PENDING_CREDIT_NOTE', 'APPLIED'] },
    };
    if (dateFrom) returnWhere.returnDate = { ...returnWhere.returnDate, gte: new Date(dateFrom) };
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
      returnWhere.returnDate = { ...returnWhere.returnDate, lte: end };
    }
    if (customerSearch) {
      returnWhere.customer = { name: { contains: customerSearch, mode: 'insensitive' } };
    }
    const returns = await prisma.salesReturn.findMany({
      where: returnWhere,
      include: {
        customer: { select: { name: true } },
        invoice:  { select: { number: true } },
      },
      orderBy: [{ returnDate: 'asc' }, { number: 'asc' }],
      take: ROW_CAP + 1,
    });
    if (returns.length > ROW_CAP) return err(ROW_CAP_MSG, 400);
    const rows = returns.map(r => ({
      id:            r.id,
      number:        r.number,
      returnDate:    r.returnDate,
      customerName:  r.customer?.name || 'Unknown',
      invoiceNumber: r.invoice?.number || '',
      status:        r.status,
      totalAmount:   Number(r.totalAmount || 0),
    }));
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.totalAmount, 0) });
  }

  /* ── Sales History ── */
  if (type === 'history') {
    const invoices = await prisma.salesInvoice.findMany({
      where: dateFilter,
      include: { customer: { select: { name: true } } },
      orderBy: { issueDate: 'desc' },
      take: 500,
    });
    const rows = invoices.map(inv => ({
      id:           inv.id,
      number:       inv.number,
      issueDate:    inv.issueDate,
      dueDate:      inv.dueDate,
      customerName: inv.customer?.name || 'Unknown',
      status:       inv.status,
      totalAmount:  Number(inv.totalAmount || 0),
    }));
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.totalAmount, 0) });
  }

  /* ── Monthly Sales Chart ── */
  if (type === 'monthly-chart') {
    const rows = (await readSalesCalendar(prisma, summaryFilter, 'month'))
      .map(({ bucket, total }) => ({ month: bucket, total }));
    return ok({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Share by Customer ── */
  if (type === 'share-by-customer') {
    const sorted = (await readCustomerSales(prisma, summaryFilter))
      .map(({ customerName, total }) => ({ customerName, total, isOthers: false }));
    const keep = topN && topN > 0 ? topN : 5;
    const rows = sorted.slice(0, keep);
    const othersTotal = sorted.slice(keep).reduce((s, r) => s + r.total, 0);
    if (othersTotal !== 0) rows.push({ customerName: 'Others', total: othersTotal, isOthers: true });
    return ok({ type, rows, grandTotal: sorted.reduce((s, r) => s + r.total, 0) });
  }

  /* ── Portion of Sales per Item (top N + Others) ── */
  if (type === 'share-by-item') {
    const sorted = (await readItemSales(prisma, summaryFilter))
      .map(({ description, total }) => ({ description, total, isOthers: false }));
    const keep = topN && topN > 0 ? topN : 5;
    const rows = sorted.slice(0, keep);
    const othersTotal = sorted.slice(keep).reduce((s, r) => s + r.total, 0);
    if (othersTotal !== 0) rows.push({ description: 'Others', total: othersTotal, isOthers: true });
    return ok({ type, rows, grandTotal: sorted.reduce((s, r) => s + r.total, 0) });
  }

  return err('Unknown report type', 400);
});
