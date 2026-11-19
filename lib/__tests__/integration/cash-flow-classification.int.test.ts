import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, expect, it } from 'vitest';
import { GET as glReport } from '@/src/app/api/v1/reports/gl/route';
import { PUT as updateAccount } from '@/src/app/api/v1/accounts/[id]/route';
import { cleanupOrg, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

it('uses reviewed cash classifications and reconciles the statement to the balance sheet', async () => {
  const org = await createTestOrg();
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Cash flow QA' } });
  const headers = { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
  try {
    const bankId = org.accounts.bankAsset;
    await prisma.account.update({ where: { id: bankId }, data: { name: 'Rekening Utama', reportGroup: 'Aset Lancar' } });
    const update = await updateAccount(new NextRequest(`http://localhost/api/v1/accounts/${bankId}`, {
      method: 'PUT', headers, body: JSON.stringify({ cashFlowClass: 'CASH' }),
    }), { params: Promise.resolve({ id: bankId }) });
    expect(update.status, await update.clone().text()).toBe(200);
    await prisma.journalEntry.create({ data: {
      organizationId: org.orgId, entryNo: 'CF-TEST', memo: 'Receipt', date: new Date('2026-01-10'), status: 'POSTED',
      totalDebit: 666000, totalCredit: 666000,
      lines: { create: [
        { lineNo: 1, accountId: bankId, debit: 666000, credit: 0 },
        { lineNo: 2, accountId: org.accounts.salesRevenue, debit: 0, credit: 666000 },
      ] },
    } });
    await prisma.journalEntry.create({ data: {
      organizationId: org.orgId, entryNo: 'CF-TEST-2', memo: 'Payment', date: new Date('2026-01-11'), status: 'POSTED',
      totalDebit: 500000, totalCredit: 500000,
      lines: { create: [
        { lineNo: 1, accountId: org.accounts.cogsExpense, debit: 500000, credit: 0 },
        { lineNo: 2, accountId: bankId, debit: 0, credit: 500000 },
      ] },
    } });
    const request = new NextRequest('http://localhost/api/v1/reports/gl?type=cash-flow-statement&dateFrom=2026-01-01&dateTo=2026-01-31', { headers });
    const response = await glReport(request);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body.summary).toMatchObject({ endingCash: 166000, netCashChange: 166000, reconciliationDifference: 0 });
    expect(body.balanceSheetCash).toBe(166000);
    expect(body.balanceSheetDifference).toBe(0);
    expect(body.unreviewedAccounts.some((a: { id: string }) => a.id === bankId)).toBe(false);
  } finally {
    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } });
  }
});
