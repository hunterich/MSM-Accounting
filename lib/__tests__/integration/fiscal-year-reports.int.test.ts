import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, expect, it } from 'vitest';
import { POST as closeYear } from '@/src/app/api/v1/fiscal-year/close/route';
import { GET as glReport } from '@/src/app/api/v1/reports/gl/route';
import { GET as dashboardReport } from '@/src/app/api/v1/reports/dashboard/route';
import { cleanupOrg, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

it('keeps closing journals on the balance sheet and out of operating results across year-end', async () => {
  const org = await createTestOrg({ fiscalYearStart: new Date('2025-01-01') });
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@test.local`, fullName: 'Year close QA' },
  });
  const headers = {
    'x-org-id': org.orgId,
    'x-user-id': user.id,
    'x-role-type': 'ADMIN',
    'content-type': 'application/json',
  };
  const year = 'dateFrom=2025-01-01&dateTo=2025-12-31';
  const january = 'dateFrom=2026-01-01&dateTo=2026-01-31';
  const compareJanuary = 'compareDateFrom=2026-01-01&compareDateTo=2026-01-31';
  const report = async (query: string, endpoint: 'gl' | 'dashboard' = 'gl') => {
    const handler = endpoint === 'gl' ? glReport : dashboardReport;
    const response = await handler(new NextRequest(`http://localhost/api/v1/reports/${endpoint}?${query}`, { headers }));
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  const results = () => Promise.all([
    report(`type=profit-loss&${year}`),
    report(`type=profit-loss&${january}`),
    report(`type=profit-loss-multi-period&${year}&${compareJanuary}`),
    report(`type=cash-flow-statement&${year}`),
    report(`type=cash-flow-statement&${january}`),
    report(`type=profit-loss&${year}`, 'dashboard'),
    report(`type=profit-loss&${january}`, 'dashboard'),
  ]);

  try {
    await prisma.account.update({
      where: { id: org.accounts.bankAsset },
      data: { reportGroup: 'Cash and Bank' },
    });
    await prisma.accountingPeriod.createMany({
      data: Array.from({ length: 12 }, (_, month) => ({
        organizationId: org.orgId,
        name: `2025-${month + 1}`,
        startDate: new Date(Date.UTC(2025, month, 1)),
        endDate: new Date(Date.UTC(2025, month + 1, 1) - 1),
        status: 'CLOSED',
        isLocked: true,
      })),
    });
    for (const [day, amount] of [['2025-12-15', 600], ['2026-01-01', 250]] as const) {
      await prisma.journalEntry.create({
        data: {
          organizationId: org.orgId,
          entryNo: `QA-${day}`,
          date: new Date(day),
          memo: 'Cash sale',
          status: 'POSTED',
          totalDebit: amount,
          totalCredit: amount,
          lines: {
            create: [
              { lineNo: 1, accountId: org.accounts.bankAsset, debit: amount, credit: 0 },
              { lineNo: 2, accountId: org.accounts.salesRevenue, debit: 0, credit: amount },
            ],
          },
        },
      });
    }

    const before = await results();
    expect(before[0].summary.netIncome).toBe(600);
    expect(before[1].summary.netIncome).toBe(250);
    const closed = await closeYear(new NextRequest('http://localhost/api/v1/fiscal-year/close', {
      method: 'POST', headers, body: '{}',
    }));
    expect(closed.status, await closed.clone().text()).toBe(201);
    const { closingEntryId, netIncome } = await closed.json();
    expect(netIncome).toBe(600);
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: closingEntryId } });
    // The accounting-date convention: the last business day, at 00:00 UTC.
    expect(entry.date.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(await results()).toEqual(before);

    for (const [day, assets] of [['2025-12-31', 600], ['2026-01-01', 850]] as const) {
      const balanceSheet = await report(`type=balance-sheet&asOfDate=${day}`);
      expect(balanceSheet.summary).toMatchObject({ totalAssets: assets, totalLiabilitiesAndEquity: assets });
      expect(balanceSheet.sections.find((section: { id: string }) => section.id === 'EQUITY').rows)
        .toContainEqual(expect.objectContaining({ accountId: org.accounts.retainedEarnings, amount: 600 }));
      const trialBalance = await report(`type=trial-balance&asOfDate=${day}`);
      expect(trialBalance.summary).toMatchObject({ endingDebit: assets, endingCredit: assets });
    }

    // Old closes were stored after midnight in Jakarta. They must also be filtered.
    await prisma.journalEntry.update({
      where: { id: closingEntryId },
      data: { date: new Date('2025-12-31T23:59:59.999Z') },
    });
    expect(await results()).toEqual(before);
  } finally {
    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } });
  }
});
