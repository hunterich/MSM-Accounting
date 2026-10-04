import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { computeStatement, computeAging, type OpenDocument } from '@/lib/statement-reporting';
import { readSubledgerHistory, reportDate } from '@/lib/subledger-history';
import type { BillStatus } from '@prisma/client';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const OPEN_BILL_STATUSES = ['OPEN', 'PENDING', 'OVERDUE', 'PAID', 'VOID'];

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

const STATEMENT_BILL_STATUSES: BillStatus[] = ['OPEN', 'PENDING', 'OVERDUE', 'PAID', 'VOID'];

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
  return String(a.vendorName || '').localeCompare(String(b.vendorName || ''));
};



export const GET = withPermission({ module: 'REPORTS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'aging';
  const asOfDate = endOfDay(searchParams.get('asOfDate'));
  const vendorSearch = searchParams.get('vendorSearch') || '';

  if (type === 'statement') {
    const vendorId = searchParams.get('vendorId') || '';
    if (!vendorId) return err('vendorId is required for a statement', 400);

    const periodStart = startOfDay(searchParams.get('dateFrom'));
    const periodEnd = endOfDay(searchParams.get('dateTo'));

    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, organizationId: orgId },
      select: { id: true, code: true, name: true, openingBalance: true },
    });
    if (!vendor) return err('Vendor not found', 404);

    const bills = await prisma.bill.findMany({
        where: { organizationId: orgId, vendorId, status: { in: STATEMENT_BILL_STATUSES }, issueDate: { lte: periodEnd } },
        select: { id: true, number: true, issueDate: true, dueDate: true, totalAmount: true, status: true },
      });
      const history = await readSubledgerHistory(prisma, 'ap', orgId, bills, periodEnd, vendorId);
      const txns = history.txns;

      const stmt = computeStatement({
      openingSeed: asMoney(toNumber(vendor.openingBalance)),
      txns,
      periodStart,
      periodEnd,
    });

    // Aging of still-open bill balances as of the period end.
    const openDocs: OpenDocument[] = history.documents.map((bill) => ({
        dueDate: bill.dueDate, balance: asMoney(Math.max(toNumber(bill.totalAmount) - (history.cleared.get(bill.id) ?? 0), 0)),
      }));
      openDocs.push({ dueDate: null, balance: toNumber(vendor.openingBalance) });
      const aging = computeAging(openDocs, periodEnd);
      const unallocatedCredit = asMoney((history.unallocated.get(vendorId) ?? 0) + history.documents.reduce((sum, d) => sum + Math.max((history.cleared.get(d.id) ?? 0) - toNumber(d.totalAmount), 0), 0));

    return ok({
      type,
      party: { id: vendor.id, code: vendor.code, name: vendor.name },
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

  const billWhere: any = {
    organizationId: orgId,
    status: { in: OPEN_BILL_STATUSES },
    issueDate: { lte: asOfDate },
  };

  if (vendorSearch) {
    billWhere.vendor = {
      name: { contains: vendorSearch, mode: 'insensitive' },
    };
  }

  const fetchedDocuments = await prisma.bill.findMany({
    where: billWhere,
    select: {
      id: true,
      number: true,
      issueDate: true,
      dueDate: true,
      status: true,
      totalAmount: true,
      vendorId: true,
      vendor: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [
      { issueDate: 'asc' },
      { number: 'asc' },
    ],
  });

  const history = await readSubledgerHistory(prisma, 'ap', orgId, fetchedDocuments, asOfDate);
    const bills = history.documents;
    const clearedByBill = history.cleared;

    const billRows = bills.map((bill) => {
    const originalAmount = asMoney(toNumber(bill.totalAmount));
    const clearedAmount = clearedByBill.get(bill.id) ?? 0;
    const balance = asMoney(originalAmount - clearedAmount);
    const overdueDays = daysOverdue(bill.dueDate, asOfDate);
    const buckets = getBucketValues(balance, overdueDays);

    return {
      billId: bill.id,
      billNumber: bill.number,
      billDate: bill.issueDate,
      dueDate: bill.dueDate,
      vendorId: bill.vendorId,
      vendorName: bill.vendor?.name || 'Unknown',
      status: String(bill.status),
      daysOverdue: overdueDays,
      originalAmount,
      clearedAmount,
      balance,
      ...buckets,
    };
  });

  const parties = await prisma.vendor.findMany({
      where: { organizationId: orgId, ...(vendorSearch ? { name: { contains: vendorSearch, mode: 'insensitive' } } : {}) },
      select: { id: true, code: true, name: true, openingBalance: true },
    });
    for (const party of parties) {
      const opening = toNumber(party.openingBalance);
      const credit = history.unallocated.get(party.id) ?? 0;
      if (opening === 0 && credit === 0) continue;
      const balance = asMoney(opening - credit);
      billRows.push({
        billId: `opening:${party.id}`, billNumber: 'Opening balance / unapplied credit',
        billDate: asOfDate, dueDate: null, vendorId: party.id,
         vendorName: party.name, status: 'OPENING_BALANCE', daysOverdue: 0,
        originalAmount: opening, clearedAmount: credit, balance, ...getBucketValues(balance, 0),
      });
    }
    const openBills = billRows.filter((row) => row.balance > 0);

  if (type === 'aging') {
    const rows = [...openBills].sort(sortByOverdue);
    const summary = rows.reduce(
      (acc, row) => ({
        current: asMoney(acc.current + row.current),
        d1To30: asMoney(acc.d1To30 + row.d1To30),
        d31To60: asMoney(acc.d31To60 + row.d31To60),
        d61To90: asMoney(acc.d61To90 + row.d61To90),
        d90Plus: asMoney(acc.d90Plus + row.d90Plus),
        totalOutstanding: asMoney(acc.totalOutstanding + row.balance),
      }),
      {
        current: 0,
        d1To30: 0,
        d31To60: 0,
        d61To90: 0,
        d90Plus: 0,
        totalOutstanding: 0,
      },
    );

    const unappliedCredits = asMoney(billRows.reduce((s, r) => s + Math.max(-r.balance, 0), 0));
      return ok({ type, rows, summary: { ...summary, unappliedCredits, netOutstanding: asMoney(summary.totalOutstanding - unappliedCredits) }, asOfDate, warnings: history.warnings });
  }

  if (type === 'vendor-balance') {
    const byVendor = new Map<string, {
      vendorId: string;
      vendorName: string;
      billedAmount: number;
      paidAmount: number;
      outstandingAmount: number;
    }>();

    for (const row of billRows) {
      const existing = byVendor.get(row.vendorId) || {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        billedAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      };

      existing.billedAmount = asMoney(existing.billedAmount + row.originalAmount);
      existing.paidAmount = asMoney(existing.paidAmount + row.clearedAmount);
      existing.outstandingAmount = asMoney(existing.outstandingAmount + row.balance);
      byVendor.set(row.vendorId, existing);
    }

    const rows = Array.from(byVendor.values())
      .filter((row) => row.outstandingAmount !== 0)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount);

    const summary = rows.reduce(
      (acc, row) => ({
        vendorCount: acc.vendorCount + 1,
        totalBilled: asMoney(acc.totalBilled + row.billedAmount),
        totalPaid: asMoney(acc.totalPaid + row.paidAmount),
        totalOutstanding: asMoney(acc.totalOutstanding + row.outstandingAmount),
      }),
      {
        vendorCount: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalOutstanding: 0,
      },
    );

    return ok({ type, rows, summary, asOfDate, warnings: history.warnings });
  }

  if (type === 'overdue-list') {
    const rows = openBills
      .filter((row) => row.daysOverdue > 0)
      .sort(sortByOverdue);

    const summary = rows.reduce(
      (acc, row) => ({
        overdueBillCount: acc.overdueBillCount + 1,
        overdueAmount: asMoney(acc.overdueAmount + row.balance),
      }),
      {
        overdueBillCount: 0,
        overdueAmount: 0,
      },
    );

    return ok({ type, rows, summary, asOfDate, warnings: history.warnings });
  }

  return err('Unknown report type', 400);
});
