/**
 * Issue #233 — one accounting-date convention for postings, period locks and
 * reports, against the real database.
 *
 *  - A clock-time posting between 00:00 and 07:00 WIB on the 1st belongs to the
 *    new month for the period lock too, so closing the previous month does not
 *    block it (and does not let it in, either, once it is really the old month).
 *  - The journal is stored on its business day, the day reports show it on.
 *  - Journal numbers survive deletion: the next number is never a reused one.
 *
 * Run with:  npm run test:int -- accounting-date
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { assertPeriodOpen } from '@/lib/period-guard';
import { allocateJournalEntryNumber, postJournalEntry } from '@/lib/journal-posting';
import { reportDate } from '@/lib/subledger-history';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

/** October 2026 CLOSED, November 2026 OPEN — UTC boundaries, as generated. */
async function octoberClosed(orgId: string): Promise<void> {
  const tag = randomUUID().slice(0, 6);
  await prisma.accountingPeriod.createMany({
    data: [
      {
        organizationId: orgId, name: `2026-10-${tag}`,
        startDate: new Date(Date.UTC(2026, 9, 1)), endDate: new Date(Date.UTC(2026, 10, 1) - 1),
        status: 'CLOSED', isLocked: true,
      },
      {
        organizationId: orgId, name: `2026-11-${tag}`,
        startDate: new Date(Date.UTC(2026, 10, 1)), endDate: new Date(Date.UTC(2026, 11, 1) - 1),
        status: 'OPEN', isLocked: false,
      },
    ],
  });
}

const sale = (org: TestOrg) => [
  { accountId: org.accounts.bankAsset, description: 'cash', debit: 100, credit: 0 },
  { accountId: org.accounts.salesRevenue, description: 'sale', debit: 0, credit: 100 },
];

describe('accounting date', () => {
  it('lets a 02:00 WIB posting on the 1st through after the previous month is closed', async () => {
    const org = await createTestOrg();
    try {
      await octoberClosed(org.orgId);
      const twoAmWib = new Date('2026-10-31T19:00:00.000Z'); // 1 Nov, 02:00 WIB

      const entry = await prisma.$transaction(async (tx) => {
        await assertPeriodOpen(tx, org.orgId, twoAmWib);
        return postJournalEntry(tx, {
          organizationId: org.orgId, date: twoAmWib, memo: 'POS sale', lines: sale(org),
        });
      });

      const stored = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(stored.date.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      // The day the reports put it on.
      expect(stored.date >= reportDate('2026-11-01', false) && stored.date <= reportDate('2026-11-01', true))
        .toBe(true);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('still refuses a posting that is really on the closed month\'s last business day', async () => {
    const org = await createTestOrg();
    try {
      await octoberClosed(org.orgId);
      const lateEveningWib = new Date('2026-10-31T16:00:00.000Z'); // 31 Oct, 23:00 WIB
      await expect(prisma.$transaction((tx) => assertPeriodOpen(tx, org.orgId, lateEveningWib)))
        .rejects.toThrow(/closed\/locked — cannot post on 2026-10-31/);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('never reissues the number of a deleted journal', async () => {
    const org = await createTestOrg();
    try {
      const post = () => prisma.$transaction((tx) => postJournalEntry(tx, {
        organizationId: org.orgId, date: new Date('2026-11-02T00:00:00.000Z'), memo: 'entry', lines: sale(org),
      }));
      await post();
      const newest = await post();
      await prisma.journalEntry.delete({ where: { id: newest.id } });

      const next = await prisma.$transaction((tx) => allocateJournalEntryNumber(tx, org.orgId));
      const seq = (no: string) => Number(no.replace('JE-', ''));
      expect(seq(next)).toBe(seq(newest.entryNo) + 1);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
