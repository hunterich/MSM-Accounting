import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {
  account: { findMany: vi.fn() }, bankAccount: { findMany: vi.fn() },
  organization: { findUnique: vi.fn() }, journalLine: { groupBy: vi.fn() },
} }));
import { prisma } from '@/lib/prisma';
import { GET } from '../reports/gl/route';

it('reports bank cash, flags unreviewed accounts and independently checks the balance sheet', async () => {
  const chart = [
    { id: 'bank', code: '1-1100', name: 'Bank BCA IDR', type: 'ASSET', normalSide: 'DEBIT', isPostable: true, isActive: true, parentId: null, reportGroup: null, cashFlowClass: null },
    { id: 'sales', code: '4', name: 'Penjualan', type: 'REVENUE', normalSide: 'CREDIT', isPostable: true, isActive: true, parentId: null, reportGroup: null, cashFlowClass: 'OPERATING' },
    { id: 'cost', code: '5', name: 'Beban', type: 'EXPENSE', normalSide: 'DEBIT', isPostable: true, isActive: true, parentId: null, reportGroup: null, cashFlowClass: 'OPERATING' },
  ];
  vi.mocked(prisma.account.findMany).mockResolvedValue(chart as never);
  vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ accountDefaults: {} } as never);
  const rows = [
    { accountId: 'bank', _sum: { debit: 666000, credit: 500000 } },
    { accountId: 'sales', _sum: { debit: 0, credit: 666000 } },
    { accountId: 'cost', _sum: { debit: 500000, credit: 0 } },
  ];
  vi.mocked(prisma.journalLine.groupBy).mockImplementation((async (args: any) => {
    const date = (args.where as any).entry.date;
    return date.lt ? [] : rows;
  }) as never);
  const request = new NextRequest('http://localhost/api/v1/reports/gl?type=cash-flow-statement&dateFrom=2026-01-01&dateTo=2026-01-31', { headers: { 'x-org-id': 'org', 'x-user-id': 'u', 'x-role-type': 'ADMIN' } });
  const res = await GET(request);
  expect(res.status, await res.clone().text()).toBe(200);
  const report = await res.json();
  expect(report.summary).toMatchObject({ endingCash: 166000, netCashChange: 166000, reconciliationDifference: 0 });
  expect(report.balanceSheetCash).toBe(166000);
  expect(report.balanceSheetDifference).toBe(0);
  expect(report.unreviewedAccounts).toEqual([{ id: 'bank', code: '1-1100', name: 'Bank BCA IDR' }]);
  expect(report.sections.flatMap((section: any) => section.rows).some((row: any) => row.accountId === 'bank')).toBe(false);

  // Closing journals are included in the balance sheet, but excluded from
  // period operating results; a cash posting there must not be silently hidden.
  vi.mocked(prisma.journalLine.groupBy).mockImplementation((async (args: any) => {
    const date = args.where.entry.date;
    if (date.lt) return [];
    if (!date.gte) return [{ ...rows[0], _sum: { debit: 666010, credit: 500000 } }, ...rows.slice(1)];
    return rows;
  }) as never);
  const mismatch = await (await GET(request)).json();
  expect(mismatch.balanceSheetCash).toBe(166010);
  expect(mismatch.balanceSheetDifference).toBe(-10);
});
