import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { computeStatement, computeAging, type OpenDocument } from '@/lib/statement-reporting';
import { readSubledgerHistory, reportDate } from '@/lib/subledger-history';
import type { InvoiceStatus } from '@prisma/client';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const OPEN_INVOICE_STATUSES: InvoiceStatus[] = ['SENT', 'OVERDUE', 'PAID', 'VOID'];
const OVERDUE_STATUSES = new Set(['SENT', 'OVERDUE', 'PAID']);

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asMoney = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const endOfDay = (value: string | null): Date => {
  try { return reportDate(value, true); } catch { throw new ApiError(`Invalid date: ${value}`, 400); }
};

const startOfDay = (value: string | null): Date => {
  try { return reportDate(value, false); } catch { throw new ApiError(`Invalid date: ${value}`, 400); }
};

const daysOverdue = (dueDate: Date | null, asOf: Date): number => {
  if (!dueDate) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((asOf.getTime() - dueDate.getTime()) / msPerDay));
};

const getBucketValues = (balance: number, overdueDays: number) => ({
  current: overdueDays <= 0 ? balance : 0,
  d1To30: overdueDays > 0 && overdueDays <= 30 ? balance : 0,
  d31To60: overdueDays > 30 && overdueDays <= 60 ? balance : 0,
  d61To90: overdueDays > 60 && overdueDays <= 90 ? balance : 0,
  d90Plus: overdueDays > 90 ? balance : 0,
});

const sortByOverdue = (a: any, b: any) => {
  if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
  const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDue !== bDue) return aDue - bDue;
  return String(a.customerName || '').localeCompare(String(b.customerName || ''));
};



export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'aging';
    const asOfDate = endOfDay(searchParams.get('asOfDate'));
    const customerSearch = searchParams.get('customerSearch') || '';
    const status = searchParams.get('status') || '';

    if (type === 'statement') {
      const customerId = searchParams.get('customerId') || '';
      if (!customerId) return err('customerId is required for a statement', 400);

      const periodStart = startOfDay(searchParams.get('dateFrom'));
      const periodEnd = endOfDay(searchParams.get('dateTo'));

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, organizationId: orgId },
        select: { id: true, code: true, name: true, openingBalance: true },
      });
      if (!customer) return err('Customer not found', 404);

      const invoices = await prisma.salesInvoice.findMany({
        where: { organizationId: orgId, customerId, status: { in: OPEN_INVOICE_STATUSES }, issueDate: { lte: periodEnd } },
        select: { id: true, number: true, issueDate: true, dueDate: true, totalAmount: true, status: true },
      });
      const history = await readSubledgerHistory(prisma, 'ar', orgId, invoices, periodEnd, customerId);
      const txns = history.txns;

      const stmt = computeStatement({
        openingSeed: asMoney(toNumber(customer.openingBalance)),
        txns,
        periodStart,
        periodEnd,
      });

      // Aging of still-open invoice balances as of the period end.
      const openDocs: OpenDocument[] = history.documents.map((inv) => ({
        dueDate: inv.dueDate, balance: asMoney(Math.max(toNumber(inv.totalAmount) - (history.cleared.get(inv.id) ?? 0), 0)),
      }));
      openDocs.push({ dueDate: null, balance: toNumber(customer.openingBalance) });
      const aging = computeAging(openDocs, periodEnd);
      const unallocatedCredit = asMoney((history.unallocated.get(customerId) ?? 0) + history.documents.reduce((sum, d) => sum + Math.max((history.cleared.get(d.id) ?? 0) - toNumber(d.totalAmount), 0), 0));

      return ok({
        type,
        party: { id: customer.id, code: customer.code, name: customer.name },
        period: { dateFrom: periodStart.toISOString(), dateTo: periodEnd.toISOString() },
        openingBalance: stmt.openingBalance,
        warnings: history.warnings,
        rows: stmt.rows,
        summary: {
          totalDebits: stmt.totalDebits,
          totalCredits: stmt.totalCredits,
          closingBalance: stmt.closingBalance,
          aging,
          unallocatedCredit,
          netOutstanding: stmt.closingBalance,
        },
      });
    }

    const invoiceWhere: any = {
      organizationId: orgId,
      status: { in: OPEN_INVOICE_STATUSES },
      issueDate: { lte: asOfDate },
    };

    if (customerSearch) {
      invoiceWhere.customer = {
        name: { contains: customerSearch, mode: 'insensitive' },
      };
    }

    if (type === 'overdue-list' && status && OVERDUE_STATUSES.has(status)) {
      invoiceWhere.status = status;
    }

    const fetchedDocuments = await prisma.salesInvoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        status: true,
        totalAmount: true,
        customerId: true,
        customer: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      orderBy: [
        { issueDate: 'asc' },
        { number: 'asc' },
      ],
    });

    const history = await readSubledgerHistory(prisma, 'ar', orgId, fetchedDocuments, asOfDate);
    const invoices = history.documents;
    const clearedByInvoice = history.cleared;

    const invoiceRows = invoices.map((invoice) => {
      const originalAmount = asMoney(toNumber(invoice.totalAmount));
      const clearedAmount = clearedByInvoice.get(invoice.id) ?? 0;
      const balance = asMoney(originalAmount - clearedAmount);
      const overdueDays = daysOverdue(invoice.dueDate, asOfDate);
      const buckets = getBucketValues(balance, overdueDays);

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        invoiceDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        customerId: invoice.customerId,
        customerCode: invoice.customer?.code || null,
        customerName: invoice.customer?.name || 'Unknown',
        status: String(invoice.status),
        daysOverdue: overdueDays,
        originalAmount,
        clearedAmount,
        balance,
        ...buckets,
      };
    });

    const parties = await prisma.customer.findMany({
      where: { organizationId: orgId, ...(customerSearch ? { name: { contains: customerSearch, mode: 'insensitive' } } : {}) },
      select: { id: true, code: true, name: true, openingBalance: true },
    });
    for (const party of parties) {
      const opening = toNumber(party.openingBalance);
      const credit = history.unallocated.get(party.id) ?? 0;
      if (opening === 0 && credit === 0) continue;
      const balance = asMoney(opening - credit);
      invoiceRows.push({
        invoiceId: `opening:${party.id}`, invoiceNumber: 'Opening balance / unapplied credit',
        invoiceDate: asOfDate, dueDate: null, customerId: party.id,
        customerCode: party.code, customerName: party.name, status: 'OPENING_BALANCE', daysOverdue: 0,
        originalAmount: opening, clearedAmount: credit, balance, ...getBucketValues(balance, 0),
      });
    }
    const openInvoices = invoiceRows.filter((row) => row.balance > 0);

    if (type === 'aging') {
      const rows = [...openInvoices].sort(sortByOverdue);
      const summary = rows.reduce((acc, row) => ({
        current: asMoney(acc.current + row.current),
        d1To30: asMoney(acc.d1To30 + row.d1To30),
        d31To60: asMoney(acc.d31To60 + row.d31To60),
        d61To90: asMoney(acc.d61To90 + row.d61To90),
        d90Plus: asMoney(acc.d90Plus + row.d90Plus),
        totalOutstanding: asMoney(acc.totalOutstanding + row.balance),
      }), {
        current: 0,
        d1To30: 0,
        d31To60: 0,
        d61To90: 0,
        d90Plus: 0,
        totalOutstanding: 0,
      });

      const unappliedCredits = asMoney(invoiceRows.reduce((s, r) => s + Math.max(-r.balance, 0), 0));
      return ok({ type, rows, summary: { ...summary, unappliedCredits, netOutstanding: asMoney(summary.totalOutstanding - unappliedCredits) }, warnings: history.warnings });
    }

    if (type === 'customer-balance') {
      const byCustomer = new Map();

      for (const row of invoiceRows) {
        const existing = byCustomer.get(row.customerId) || {
          customerId: row.customerId,
          customerCode: row.customerCode,
          customerName: row.customerName,
          invoicedAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
        };

        existing.invoicedAmount = asMoney(existing.invoicedAmount + row.originalAmount);
        existing.paidAmount = asMoney(existing.paidAmount + row.clearedAmount);
        existing.outstandingAmount = asMoney(existing.outstandingAmount + row.balance);
        byCustomer.set(row.customerId, existing);
      }

      const rows = Array.from(byCustomer.values())
        .filter((row) => row.outstandingAmount !== 0)
        .sort((a, b) => b.outstandingAmount - a.outstandingAmount);

      const summary = rows.reduce((acc, row) => ({
        customerCount: acc.customerCount + 1,
        totalInvoiced: asMoney(acc.totalInvoiced + row.invoicedAmount),
        totalPaid: asMoney(acc.totalPaid + row.paidAmount),
        totalOutstanding: asMoney(acc.totalOutstanding + row.outstandingAmount),
      }), {
        customerCount: 0,
        totalInvoiced: 0,
        totalPaid: 0,
        totalOutstanding: 0,
      });

      return ok({ type, rows, summary, warnings: history.warnings });
    }

    if (type === 'overdue-list') {
      const rows = openInvoices
        .filter((row) => row.daysOverdue > 0)
        .sort(sortByOverdue);

      const summary = rows.reduce((acc, row) => ({
        overdueInvoiceCount: acc.overdueInvoiceCount + 1,
        overdueAmount: asMoney(acc.overdueAmount + row.balance),
      }), {
        overdueInvoiceCount: 0,
        overdueAmount: 0,
      });

      return ok({ type, rows, summary, warnings: history.warnings });
    }

  return err('Unknown report type', 400);
});
