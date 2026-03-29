// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

  const { searchParams } = new URL(req.url);
  const type           = searchParams.get('type') || 'by-customer';
  const dateFrom       = searchParams.get('dateFrom');
  const dateTo         = searchParams.get('dateTo');
  const customerSearch = searchParams.get('customerSearch') || '';
  const itemSearch     = searchParams.get('itemSearch') || '';
  const topNRaw        = searchParams.get('topN');
  const topN           = topNRaw ? parseInt(topNRaw, 10) : null;
  const sortBy         = searchParams.get('sortBy') || 'total'; // 'total' | 'qty'

  const dateFilter: any = {
    organizationId: orgId,
    status: { not: 'VOID' },
  };
  if (dateFrom) dateFilter.issueDate = { ...dateFilter.issueDate, gte: new Date(dateFrom) };
  if (dateTo) {
    const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
    dateFilter.issueDate = { ...dateFilter.issueDate, lte: end };
  }

  try {
    /* ── Sales by Customer ── */
    if (type === 'by-customer') {
      const customerWhere: any = { ...dateFilter };
      if (customerSearch) {
        customerWhere.customer = { name: { contains: customerSearch, mode: 'insensitive' } };
      }
      const invoices = await prisma.salesInvoice.findMany({
        where: customerWhere,
        include: { customer: { select: { id: true, name: true } } },
      });
      const map = new Map();
      for (const inv of invoices) {
        const key  = inv.customerId || 'unknown';
        const name = inv.customer?.name || 'Unknown';
        if (!map.has(key)) map.set(key, { customerId: key, customerName: name, total: 0, invoiceCount: 0 });
        const row = map.get(key);
        row.total += Number(inv.totalAmount || 0);
        row.invoiceCount += 1;
      }
      let rows = Array.from(map.values()).sort((a, b) => b.total - a.total);
      if (topN && topN > 0) rows = rows.slice(0, topN);
      return withCors(NextResponse.json({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) }));
    }

    /* ── Sales by Item ── */
    if (type === 'by-item') {
      const lines = await prisma.salesInvoiceLine.findMany({
        where: { invoice: dateFilter },
      });
      const map = new Map();
      for (const line of lines) {
        const key = line.description;
        if (!map.has(key)) map.set(key, { description: key, code: line.code, qty: 0, total: 0 });
        const row = map.get(key);
        row.qty   += Number(line.quantity || 0);
        row.total += Number(line.lineSubtotal || 0);
      }
      let rows = Array.from(map.values());
      // Apply item search filter
      if (itemSearch) {
        const q = itemSearch.toLowerCase();
        rows = rows.filter(r => r.description?.toLowerCase().includes(q));
      }
      // Sort by qty or total
      rows = rows.sort((a, b) => sortBy === 'qty' ? b.qty - a.qty : b.total - a.total);
      // Apply top N limit
      if (topN && topN > 0) rows = rows.slice(0, topN);
      return withCors(NextResponse.json({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) }));
    }

    /* ── Sales Item × Customer ── */
    if (type === 'by-item-customer') {
      const lines = await prisma.salesInvoiceLine.findMany({
        where: { invoice: dateFilter },
        include: { invoice: { select: { customerId: true, customer: { select: { name: true } } } } },
      });
      const map = new Map();
      for (const line of lines) {
        const key          = `${line.invoice.customerId}||${line.description}`;
        const customerName = line.invoice.customer?.name || 'Unknown';
        if (!map.has(key)) map.set(key, { customerName, description: line.description, qty: 0, total: 0 });
        const row = map.get(key);
        row.qty   += Number(line.quantity || 0);
        row.total += Number(line.lineSubtotal || 0);
      }
      let rows = Array.from(map.values());
      if (customerSearch) {
        const q = customerSearch.toLowerCase();
        rows = rows.filter((row) => row.customerName?.toLowerCase().includes(q));
      }
      if (itemSearch) {
        const q = itemSearch.toLowerCase();
        rows = rows.filter((row) => row.description?.toLowerCase().includes(q));
      }
      rows = rows.sort((a, b) => b.total - a.total);
      return withCors(NextResponse.json({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) }));
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
      return withCors(NextResponse.json({ type, rows, grandTotal: rows.reduce((s, r) => s + r.totalAmount, 0) }));
    }

    /* ── Monthly Sales Chart ── */
    if (type === 'monthly-chart') {
      const invoices = await prisma.salesInvoice.findMany({
        where: dateFilter,
        select: { issueDate: true, totalAmount: true },
        orderBy: { issueDate: 'asc' },
      });
      const map = new Map();
      for (const inv of invoices) {
        const d   = new Date(inv.issueDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        map.set(key, (map.get(key) || 0) + Number(inv.totalAmount || 0));
      }
      const rows = Array.from(map.entries()).map(([month, total]) => ({ month, total }));
      return withCors(NextResponse.json({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) }));
    }

    /* ── Share by Customer ── */
    if (type === 'share-by-customer') {
      const invoices = await prisma.salesInvoice.findMany({
        where: dateFilter,
        include: { customer: { select: { name: true } } },
      });
      const map = new Map();
      for (const inv of invoices) {
        const key  = inv.customerId || 'unknown';
        const name = inv.customer?.name || 'Unknown';
        if (!map.has(key)) map.set(key, { customerName: name, total: 0 });
        map.get(key).total += Number(inv.totalAmount || 0);
      }
      const rows = Array.from(map.values()).sort((a, b) => b.total - a.total);
      return withCors(NextResponse.json({ type, rows, grandTotal: rows.reduce((s, r) => s + r.total, 0) }));
    }

    return withCors(NextResponse.json({ error: 'Unknown report type' }, { status: 400 }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report error';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
