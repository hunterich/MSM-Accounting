// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const OPEN_INVOICE_STATUSES = ['SENT', 'OVERDUE', 'PAID'];
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
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  date.setHours(23, 59, 59, 999);
  return date;
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

const emptySummaryByType = (type: string) => {
  if (type === 'aging') {
    return {
      current: 0,
      d1To30: 0,
      d31To60: 0,
      d61To90: 0,
      d90Plus: 0,
      totalOutstanding: 0,
    };
  }

  if (type === 'customer-balance') {
    return {
      customerCount: 0,
      totalInvoiced: 0,
      totalPaid: 0,
      totalOutstanding: 0,
    };
  }

  if (type === 'overdue-list') {
    return {
      overdueInvoiceCount: 0,
      overdueAmount: 0,
    };
  }

  return {};
};

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'aging';
    const asOfDate = endOfDay(searchParams.get('asOfDate'));
    const customerSearch = searchParams.get('customerSearch') || '';
    const status = searchParams.get('status') || '';

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

    const invoices = await prisma.salesInvoice.findMany({
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

    if (invoices.length === 0) {
      return withCors(NextResponse.json({ type, rows: [], summary: emptySummaryByType(type) }));
    }

    const allocations = await prisma.aRPaymentAllocation.groupBy({
      by: ['invoiceId'],
      where: {
        invoiceId: { in: invoices.map((invoice) => invoice.id) },
        payment: {
          organizationId: orgId,
          status: 'COMPLETED',
          date: { lte: asOfDate },
        },
      },
      _sum: {
        amountApplied: true,
        discountAmount: true,
      },
    });

    const clearedByInvoice = new Map(
      allocations.map((row) => {
        const cleared = toNumber(row._sum.amountApplied) + toNumber(row._sum.discountAmount);
        return [row.invoiceId, asMoney(cleared)];
      }),
    );

    const invoiceRows = invoices.map((invoice) => {
      const originalAmount = asMoney(toNumber(invoice.totalAmount));
      const clearedAmount = Math.min(originalAmount, clearedByInvoice.get(invoice.id) ?? 0);
      const balance = asMoney(Math.max(originalAmount - clearedAmount, 0));
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
        status: invoice.status,
        daysOverdue: overdueDays,
        originalAmount,
        clearedAmount,
        balance,
        ...buckets,
      };
    });

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

      return withCors(NextResponse.json({ type, rows, summary }));
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
        .filter((row) => row.outstandingAmount > 0)
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

      return withCors(NextResponse.json({ type, rows, summary }));
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

      return withCors(NextResponse.json({ type, rows, summary }));
    }

    return withCors(NextResponse.json({ error: 'Unknown report type' }, { status: 400 }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report error';
    const status = message.startsWith('Invalid date:') ? 400 : 500;
    return withCors(NextResponse.json({ error: message }, { status }));
  }
}
