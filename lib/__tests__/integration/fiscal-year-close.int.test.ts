/**
 * Fiscal-year close: the closing journal entry, against the real database.
 *
 * The property that matters is the accounting one — after the close, every
 * revenue and expense account reads zero for the year and Retained Earnings
 * has absorbed exactly the net income. These tests assert that from the ledger
 * itself rather than from the entry we just built, so a bug in the line-
 * building maths cannot pass by agreeing with itself.
 *
 * Run with:  npm run test:int -- fiscal-year-close
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as closeYear } from '@/src/app/api/v1/fiscal-year/close/route';
import { POST as reopenYear } from '@/src/app/api/v1/fiscal-year/reopen/route';
import { GET as closePreview } from '@/src/app/api/v1/fiscal-year/close-preview/route';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

const FY_START = new Date('2026-01-01T00:00:00.000Z');
const FY_END = new Date(Date.UTC(2027, 0, 1) - 1);
const IN_YEAR = new Date('2026-06-15T00:00:00.000Z');

async function makeUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `fy-closer-${randomUUID()}@example.test`, fullName: 'FY Closer' },
    select: { id: true },
  });
  return u.id;
}

/** Twelve CLOSED monthly periods covering the fiscal year. */
async function closedYearPeriods(orgId: string, closedMonths = 12): Promise<void> {
  const tag = randomUUID().slice(0, 6);
  for (let i = 0; i < 12; i += 1) {
    await prisma.accountingPeriod.create({
      data: {
        organizationId: orgId,
        name: `2026-${String(i + 1).padStart(2, '0')}-${tag}`,
        startDate: new Date(Date.UTC(2026, i, 1)),
        endDate: new Date(Date.UTC(2026, i + 1, 1) - 1),
        status: i < closedMonths ? 'CLOSED' : 'OPEN',
        isLocked: i < closedMonths,
      },
    });
  }
}

/** A POSTED entry inside the year: Dr bank / Cr revenue, or Dr expense / Cr bank. */
async function postActivity(org: TestOrg, opts: { revenue?: number; expense?: number }): Promise<void> {
  const { revenue = 0, expense = 0 } = opts;
  const lines: Array<{ lineNo: number; accountId: string; debit: number; credit: number }> = [];
  let n = 0;
  if (revenue) {
    lines.push({ lineNo: ++n, accountId: org.accounts.bankAsset, debit: revenue, credit: 0 });
    lines.push({ lineNo: ++n, accountId: org.accounts.salesRevenue, debit: 0, credit: revenue });
  }
  if (expense) {
    lines.push({ lineNo: ++n, accountId: org.accounts.cogsExpense, debit: expense, credit: 0 });
    lines.push({ lineNo: ++n, accountId: org.accounts.bankAsset, debit: 0, credit: expense });
  }
  const total = revenue + expense;
  await prisma.journalEntry.create({
    data: {
      organizationId: org.orgId,
      entryNo: `JE-ACT-${randomUUID().slice(0, 8)}`,
      date: IN_YEAR,
      memo: 'activity in the year',
      status: 'POSTED',
      postedAt: new Date(),
      totalDebit: total,
      totalCredit: total,
      lines: { create: lines },
    },
  });
}

function request(orgId: string, userId: string, path: string, method = 'POST'): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    method,
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': userId,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
  });
}

const callClose = (orgId: string, userId: string) =>
  closeYear(request(orgId, userId, '/api/v1/fiscal-year/close'));
const callReopen = (orgId: string, userId: string) =>
  reopenYear(request(orgId, userId, '/api/v1/fiscal-year/reopen'));
const callPreview = (orgId: string, userId: string) =>
  closePreview(request(orgId, userId, '/api/v1/fiscal-year/close-preview', 'GET'));

/** Net movement on an account inside the fiscal year, signed on its normal side. */
async function yearBalance(orgId: string, accountId: string, normal: 'DEBIT' | 'CREDIT') {
  const rows = await prisma.$queryRaw<Array<{ debit: string; credit: string }>>`
    SELECT COALESCE(SUM(l."debit"), 0)::text AS "debit",
           COALESCE(SUM(l."credit"), 0)::text AS "credit"
    FROM "JournalLine" l
    JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE e."organizationId" = ${orgId}
      AND e."status" = 'POSTED'
      AND e."date" >= ${FY_START} AND e."date" <= ${FY_END}
      AND l."accountId" = ${accountId}
  `;
  const debit = Number(rows[0].debit);
  const credit = Number(rows[0].credit);
  return normal === 'DEBIT' ? debit - credit : credit - debit;
}

describe('fiscal-year close', () => {
  it('zeroes revenue and expense for the year and books net income to retained earnings', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId);
      await postActivity(org, { revenue: 1000, expense: 400 });

      const res = await callClose(org.orgId, userId);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.netIncome).toBeCloseTo(600, 2);

      // Asserted from the ledger, not from the entry we posted.
      expect(await yearBalance(org.orgId, org.accounts.salesRevenue, 'CREDIT')).toBeCloseTo(0, 2);
      expect(await yearBalance(org.orgId, org.accounts.cogsExpense, 'DEBIT')).toBeCloseTo(0, 2);

      expect(await yearBalance(org.orgId, org.accounts.retainedEarnings, 'CREDIT')).toBeCloseTo(600, 2);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('debits retained earnings on a net loss', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId);
      await postActivity(org, { revenue: 300, expense: 800 });

      const body = await (await callClose(org.orgId, userId)).json();
      expect(body.netIncome).toBeCloseTo(-500, 2);

      // A loss reduces equity.
      expect(await yearBalance(org.orgId, org.accounts.retainedEarnings, 'CREDIT')).toBeCloseTo(-500, 2);
      expect(await yearBalance(org.orgId, org.accounts.salesRevenue, 'CREDIT')).toBeCloseTo(0, 2);
      expect(await yearBalance(org.orgId, org.accounts.cogsExpense, 'DEBIT')).toBeCloseTo(0, 2);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('posts a balanced entry dated the last day of the year', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId);
      await postActivity(org, { revenue: 1234.56, expense: 789.01 });
      await callClose(org.orgId, userId);

      const entry = await prisma.journalEntry.findFirstOrThrow({
        where: { organizationId: org.orgId, source: 'CLOSING' },
        select: { date: true, totalDebit: true, totalCredit: true, status: true },
      });
      expect(Number(entry.totalDebit)).toBeCloseTo(Number(entry.totalCredit), 2);
      expect(entry.status).toBe('POSTED');
      expect(entry.date.toISOString().slice(0, 10)).toBe('2026-12-31');
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses while any month of the year is still open', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId, 11); // December left OPEN
      await postActivity(org, { revenue: 1000, expense: 400 });

      const preview = await (await callPreview(org.orgId, userId)).json();
      expect(preview.canClose).toBe(false);
      expect(preview.openMonths).toHaveLength(1);

      const res = await callClose(org.orgId, userId);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/close every month/i);
      expect(await prisma.journalEntry.count({
        where: { organizationId: org.orgId, source: 'CLOSING' },
      })).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses to close the same year twice', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId);
      await postActivity(org, { revenue: 1000, expense: 400 });
      expect((await callClose(org.orgId, userId)).status).toBe(201);

      const again = await callClose(org.orgId, userId);
      expect(again.status).toBe(422);
      expect((await again.json()).error).toMatch(/already closed/i);
      expect(await prisma.journalEntry.count({
        where: { organizationId: org.orgId, source: 'CLOSING' },
      })).toBe(1);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reopening deletes the closing entry and lets the year be closed again', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId);
      await postActivity(org, { revenue: 1000, expense: 400 });
      await callClose(org.orgId, userId);

      const res = await callReopen(org.orgId, userId);
      expect(res.status).toBe(200);

      // Entry, its lines, and the close record all go together.
      expect(await prisma.journalEntry.count({
        where: { organizationId: org.orgId, source: 'CLOSING' },
      })).toBe(0);
      expect(await prisma.fiscalYearClose.count({ where: { organizationId: org.orgId } })).toBe(0);

      // Revenue is back to its pre-close balance, so a re-close is meaningful.
      expect(await yearBalance(org.orgId, org.accounts.salesRevenue, 'CREDIT')).toBeCloseTo(1000, 2);
      expect((await callClose(org.orgId, userId)).status).toBe(201);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses to reopen a year that is not closed', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      const res = await callReopen(org.orgId, userId);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/not closed/i);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('a second year closes on its own activity, not the first year all over again', async () => {
    const org = await createTestOrg({ fiscalYearStart: FY_START });
    const userId = await makeUser();
    try {
      await closedYearPeriods(org.orgId);
      await postActivity(org, { revenue: 1000, expense: 400 });
      await callClose(org.orgId, userId);

      // Year two: its own periods and its own activity.
      const tag = randomUUID().slice(0, 6);
      for (let i = 0; i < 12; i += 1) {
        await prisma.accountingPeriod.create({
          data: {
            organizationId: org.orgId,
            name: `2027-${String(i + 1).padStart(2, '0')}-${tag}`,
            startDate: new Date(Date.UTC(2027, i, 1)),
            endDate: new Date(Date.UTC(2027, i + 1, 1) - 1),
            status: 'CLOSED',
            isLocked: true,
          },
        });
      }
      await prisma.journalEntry.create({
        data: {
          organizationId: org.orgId,
          entryNo: `JE-Y2-${randomUUID().slice(0, 8)}`,
          date: new Date('2027-06-15T00:00:00.000Z'),
          memo: 'year two activity',
          status: 'POSTED',
          postedAt: new Date(),
          totalDebit: 500,
          totalCredit: 500,
          lines: {
            create: [
              { lineNo: 1, accountId: org.accounts.bankAsset, debit: 500, credit: 0 },
              { lineNo: 2, accountId: org.accounts.salesRevenue, debit: 0, credit: 500 },
            ],
          },
        },
      });

      const body = await (await closeYear(
        new NextRequest(new URL('/api/v1/fiscal-year/close', 'http://localhost'), {
          method: 'POST',
          headers: new Headers({
            'x-org-id': org.orgId, 'x-user-id': userId,
            'x-role-type': 'ADMIN', 'content-type': 'application/json',
          }),
          body: JSON.stringify({ fiscalYearStart: '2027-01-01T00:00:00.000Z' }),
        }),
      )).json();

      // 500, not 1100 — the first year's revenue was already closed out and
      // must not be swept up a second time.
      expect(body.netIncome).toBeCloseTo(500, 2);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
