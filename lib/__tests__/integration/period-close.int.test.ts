/**
 * Month-end close: the full loop against the real routes and the real database.
 *
 * Three things this locks down, each of which was broken or missing before:
 *
 *  1. Closing stamps `closedAt` / `closedById`. The close route used to flip
 *     status and nothing else, so "who signed this month off" had no answer.
 *  2. The pre-close check counts drafts by DATE. It used to count
 *     `where periodId = <period>`, and `periodId` is only ever populated when a
 *     client passes it explicitly on a manual journal — so the check passed on
 *     periods full of unposted work.
 *  3. Close and reopen actually move the posting lock. Closing makes
 *     `assertPeriodOpen` refuse the period; reopening lets it through again and
 *     clears the stamp.
 *
 * Run with:  npm run test:int -- period-close
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as closePeriod } from '@/src/app/api/v1/accounting-periods/[id]/close/route';
import { POST as reopenPeriod } from '@/src/app/api/v1/accounting-periods/[id]/reopen/route';
import { GET as closeChecklist } from '@/src/app/api/v1/accounting-periods/[id]/close-checklist/route';
import { assertPeriodOpen } from '@/lib/period-guard';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

const IN_PERIOD = new Date('2026-03-15T00:00:00.000Z');

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `period-closer-${randomUUID()}@example.test`,
      fullName: 'Period Closer',
    },
    select: { id: true },
  });
  return user.id;
}

async function makePeriod(orgId: string) {
  return prisma.accountingPeriod.create({
    data: {
      organizationId: orgId,
      name: `2026-03-${randomUUID().slice(0, 8)}`,
      startDate: new Date('2026-03-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z'),
      status: 'OPEN',
      isLocked: false,
    },
  });
}

function request(orgId: string, userId: string, path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    method: 'POST',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': userId,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
  });
}

const callClose = (orgId: string, userId: string, id: string) =>
  closePeriod(request(orgId, userId, `/api/v1/accounting-periods/${id}/close`), {
    params: Promise.resolve({ id }),
  });

const callReopen = (orgId: string, userId: string, id: string) =>
  reopenPeriod(request(orgId, userId, `/api/v1/accounting-periods/${id}/reopen`), {
    params: Promise.resolve({ id }),
  });

const callChecklist = (orgId: string, userId: string, id: string) =>
  closeChecklist(request(orgId, userId, `/api/v1/accounting-periods/${id}/close-checklist`), {
    params: Promise.resolve({ id }),
  });

/** A DRAFT journal dated inside the period, with periodId left NULL — which is
 *  what every automatic posting path produces. */
async function draftJournalWithoutPeriodId(org: TestOrg): Promise<void> {
  await prisma.journalEntry.create({
    data: {
      organizationId: org.orgId,
      entryNo: `JE-DRAFT-${randomUUID().slice(0, 8)}`,
      date: IN_PERIOD,
      memo: 'unposted work inside the period',
      status: 'DRAFT',
      totalDebit: 100,
      totalCredit: 100,
      periodId: null,
      lines: {
        create: [
          { lineNo: 1, accountId: org.accounts.bankAsset, debit: 100, credit: 0 },
          { lineNo: 2, accountId: org.accounts.salesRevenue, debit: 0, credit: 100 },
        ],
      },
    },
  });
}

describe('month-end close', () => {
  it('stamps who closed the period and when, and moves the posting lock', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const period = await makePeriod(org.orgId);

      // Open: posting on a date inside the period is allowed.
      await expect(
        prisma.$transaction((tx) => assertPeriodOpen(tx, org.orgId, IN_PERIOD)),
      ).resolves.toBeUndefined();

      const res = await callClose(org.orgId, userId, period.id);
      expect(res.status).toBe(200);

      const closed = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } });
      expect(closed.status).toBe('CLOSED');
      expect(closed.isLocked).toBe(true);
      expect(closed.closedById).toBe(userId);
      expect(closed.closedAt).toBeInstanceOf(Date);

      // Closed: the same posting date is now refused.
      await expect(
        prisma.$transaction((tx) => assertPeriodOpen(tx, org.orgId, IN_PERIOD)),
      ).rejects.toThrow(/closed\/locked/i);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses to close a second time', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const period = await makePeriod(org.orgId);
      expect((await callClose(org.orgId, userId, period.id)).status).toBe(200);

      const again = await callClose(org.orgId, userId, period.id);
      expect(again.status).toBe(422);
      expect((await again.json()).error).toMatch(/already closed/i);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('blocks the close on a draft journal that carries no periodId', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const period = await makePeriod(org.orgId);
      await draftJournalWithoutPeriodId(org);

      // The checklist must see it...
      const checklist = await (await callChecklist(org.orgId, userId, period.id)).json();
      const unposted = checklist.items.find((i: { key: string }) => i.key === 'unposted_journals');
      expect(unposted.count).toBe(1);
      expect(checklist.canClose).toBe(false);

      // ...and the close must refuse on it. Counting by periodId (the old
      // behaviour) would have found 0 and closed over the draft.
      const res = await callClose(org.orgId, userId, period.id);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/unposted journal/i);

      const stillOpen = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } });
      expect(stillOpen.status).toBe('OPEN');
      expect(stillOpen.closedAt).toBeNull();
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('reopens: clears the stamp and lets posting through again', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const period = await makePeriod(org.orgId);
      await callClose(org.orgId, userId, period.id);

      const res = await callReopen(org.orgId, userId, period.id);
      expect(res.status).toBe(200);

      const reopened = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } });
      expect(reopened.status).toBe('OPEN');
      expect(reopened.isLocked).toBe(false);
      expect(reopened.closedAt).toBeNull();
      expect(reopened.closedById).toBeNull();

      await expect(
        prisma.$transaction((tx) => assertPeriodOpen(tx, org.orgId, IN_PERIOD)),
      ).resolves.toBeUndefined();
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses to reopen a period that is not closed', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const period = await makePeriod(org.orgId);
      const res = await callReopen(org.orgId, userId, period.id);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/not closed/i);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('records the previous closer on the reopen audit row', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const period = await makePeriod(org.orgId);
      await callClose(org.orgId, userId, period.id);
      await callReopen(org.orgId, userId, period.id);

      // logAudit is fire-and-forget; give it a beat to land.
      await new Promise((r) => setTimeout(r, 200));
      const rows = await prisma.auditLog.findMany({
        where: { organizationId: org.orgId, entityType: 'AccountingPeriod', entityId: period.id },
      });
      const reopen = rows.find((r) => (r.payload as { action?: string } | null)?.action === 'reopen');
      // The stamp is cleared on the row, so the trail is the only place the
      // original closer survives.
      expect((reopen?.payload as { previouslyClosedById?: string })?.previouslyClosedById).toBe(userId);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
