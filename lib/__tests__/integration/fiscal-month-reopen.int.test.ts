import { closeFiscalYear } from '@/lib/fiscal-year-close';
import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST as closeYear } from '@/src/app/api/v1/fiscal-year/close/route';
import { POST as reopenYear } from '@/src/app/api/v1/fiscal-year/reopen/route';
import { POST as reopenMonth } from '@/src/app/api/v1/accounting-periods/[id]/reopen/route';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
it('does not reopen a month while its fiscal-year closing entry remains posted', async () => {
  const org = await createTestOrg({ fiscalYearStart: new Date('2026-01-01') });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Year close QA' } });
  try {
    let october = '';
    for (let i = 0; i < 12; i++) {
      const p = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: `2026-${i + 1}`, startDate: new Date(Date.UTC(2026, i, 1)), endDate: new Date(Date.UTC(2026, i + 1, 1) - 1), status: 'CLOSED', isLocked: true } });
      if (i === 9) october = p.id;
    }
    await prisma.journalEntry.create({ data: { organizationId: org.orgId, entryNo: 'QA-ACTIVITY', memo: 'QA activity', date: new Date('2026-10-02'), status: 'POSTED', totalDebit: 600, totalCredit: 600,
      lines: { create: [{ lineNo: 1, accountId: org.accounts.arControl, debit: 600, credit: 0 }, { lineNo: 2, accountId: org.accounts.salesRevenue, debit: 0, credit: 600 }] } } });
    const headers = { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
    const closed = await closeYear(new NextRequest('http://localhost/api/v1/fiscal-year/close', { method: 'POST', headers, body: '{}' }));
    expect(closed.status, await closed.clone().text()).toBe(201);
    const reopened = await reopenMonth(new NextRequest('http://localhost/api/v1/accounting-periods/reopen', { method: 'POST', headers }), { params: Promise.resolve({ id: october }) });
    expect(reopened.status, await reopened.clone().text()).toBe(422);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: october } })).status).toBe('CLOSED');
    expect(await prisma.fiscalYearClose.count({ where: { organizationId: org.orgId } })).toBe(1);
    const yearReopened = await reopenYear(new NextRequest('http://localhost/api/v1/fiscal-year/reopen', { method: 'POST', headers, body: '{}' }));
    expect(yearReopened.status, await yearReopened.clone().text()).toBe(200);
    const monthReopened = await reopenMonth(new NextRequest('http://localhost/api/v1/accounting-periods/reopen', { method: 'POST', headers }), { params: Promise.resolve({ id: october }) });
    expect(monthReopened.status, await monthReopened.clone().text()).toBe(200);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: october } })).status).toBe('OPEN');
  } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});

for (const yearFirst of [true, false]) it(`${yearFirst ? 'year close' : 'month reopen'} wins their concurrent race`, async () => {
  const org = await createTestOrg({ fiscalYearStart: new Date('2026-01-01') });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Year race QA' } });
  let release!: () => void, ready!: () => void;
  const hold = new Promise<void>(done => { release = done; }), held = new Promise<void>(done => { ready = done; });
  let firstResult: Promise<unknown> | undefined, secondResult: Promise<unknown> | undefined;
  try {
    let monthId = '';
    for (let i = 0; i < 12; i++) {
      const p = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: `2026-${i + 1}`, startDate: new Date(Date.UTC(2026, i, 1)), endDate: new Date(Date.UTC(2026, i + 1, 1) - 1), status: 'CLOSED', isLocked: true } });
      if (i === 9) monthId = p.id;
    }
    await prisma.journalEntry.create({ data: { organizationId: org.orgId, entryNo: 'QA-ACTIVITY', memo: 'QA', date: new Date('2026-10-02'), status: 'POSTED', totalDebit: 600, totalCredit: 600,
      lines: { create: [{ lineNo: 1, accountId: org.accounts.arControl, debit: 600, credit: 0 }, { lineNo: 2, accountId: org.accounts.salesRevenue, debit: 0, credit: 600 }] } } });
    const headers = { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
    const first = prisma.$transaction(async tx => {
      if (yearFirst) await closeFiscalYear(tx, org.orgId, new Date('2026-01-01'), user.id);
      else {
        await tx.$queryRaw`SELECT "id" FROM "AccountingPeriod" WHERE "id" = ${monthId} FOR UPDATE`;
        await tx.accountingPeriod.update({ where: { id: monthId }, data: { status: 'OPEN', isLocked: false } });
      }
      ready(); await hold;
    }, { timeout: 15000 });
    firstResult = first.then(() => null, error => error);
    await Promise.race([held, first.then(() => { throw new Error('First transaction did not hold its locks'); })]);
    secondResult = (yearFirst
      ? reopenMonth(new NextRequest('http://localhost/api/v1/accounting-periods/reopen', { method: 'POST', headers }), { params: Promise.resolve({ id: monthId }) }).then(r => r.status)
      : prisma.$transaction(tx => closeFiscalYear(tx, org.orgId, new Date('2026-01-01'), user.id), { timeout: 15000 }).then(() => 200, e => e.status));
    const deadline = Date.now() + 3000; let blocked = false;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`;
      if (Number(row.count) > 0) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    expect(blocked, 'second operation must wait on a PostgreSQL lock').toBe(true);
    release(); expect(await firstResult).toBeNull(); expect(await secondResult).toBe(422);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: monthId } })).status).toBe(yearFirst ? 'CLOSED' : 'OPEN');
    expect(await prisma.fiscalYearClose.count({ where: { organizationId: org.orgId } })).toBe(yearFirst ? 1 : 0);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId, source: 'CLOSING' } })).toBe(yearFirst ? 1 : 0);
  } finally { release(); await firstResult; await secondResult; await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});
