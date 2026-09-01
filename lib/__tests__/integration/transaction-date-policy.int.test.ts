/**
 * The transaction-date window, against a real database.
 *
 * The unit tests cover the arithmetic; these cover the part that can only be
 * wrong in wiring: that the policy is read from the org, that BLOCK actually
 * refuses, that WARN actually does not, and that the override lets a caller
 * through. `assertPeriodOpen` is the thing under test because the window rides
 * on it — which is what makes it reach every posting path.
 *
 * Run with:  npm run test:int -- transaction-date-policy
 */
import { afterAll, describe, expect, it } from 'vitest';
import { assertPeriodOpen } from '@/lib/period-guard';
import { loadTransactionDatePolicy } from '@/lib/transaction-date-policy';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => {
  await disconnect();
});

const NOW = new Date('2026-06-15T09:00:00.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function setPolicy(orgId: string, policy: unknown): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { transactionDatePolicy: policy as never },
  });
}

/** No AccountingPeriod rows exist for these orgs, so the period lock never fires. */
const guard = (orgId: string, date: Date, opts: Record<string, unknown> = {}) =>
  prisma.$transaction((tx) => assertPeriodOpen(tx, orgId, date, { now: NOW, ...opts }));

describe('transaction-date window', () => {
  it('allows any date when no policy has been configured', async () => {
    const org = await createTestOrg();
    try {
      await expect(guard(org.orgId, day('2001-01-01'))).resolves.toBeUndefined();
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses a backdated document in BLOCK mode', async () => {
    const org = await createTestOrg();
    try {
      await setPolicy(org.orgId, { enabled: true, mode: 'BLOCK', daysBefore: 30, daysAfter: 7 });

      await expect(guard(org.orgId, day('2026-05-16'))).resolves.toBeUndefined(); // exactly -30
      await expect(guard(org.orgId, day('2026-05-15'))).rejects.toThrow(/31 days in the past/);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('refuses a post-dated document in BLOCK mode', async () => {
    const org = await createTestOrg();
    try {
      await setPolicy(org.orgId, { enabled: true, mode: 'BLOCK', daysBefore: null, daysAfter: 7 });

      await expect(guard(org.orgId, day('2026-06-22'))).resolves.toBeUndefined(); // exactly +7
      await expect(guard(org.orgId, day('2026-06-23'))).rejects.toThrow(/8 days in the future/);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('lets everything through in WARN mode — the form has already said so', async () => {
    const org = await createTestOrg();
    try {
      await setPolicy(org.orgId, { enabled: true, mode: 'WARN', daysBefore: 1, daysAfter: 1 });
      await expect(guard(org.orgId, day('2020-01-01'))).resolves.toBeUndefined();
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('lets a caller with the override through a BLOCK policy', async () => {
    const org = await createTestOrg();
    try {
      await setPolicy(org.orgId, { enabled: true, mode: 'BLOCK', daysBefore: 30, daysAfter: 0 });

      await expect(guard(org.orgId, day('2020-01-01'))).rejects.toThrow(/in the past/);
      await expect(
        guard(org.orgId, day('2020-01-01'), { overrideDateRestriction: true }),
      ).resolves.toBeUndefined();
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  /**
   * A date can break both rules at once. The closed period is the more useful
   * thing to be told — reopening it is a different action from widening a window.
   */
  it('reports the closed period first when a date breaks both rules', async () => {
    const org = await createTestOrg();
    try {
      await setPolicy(org.orgId, { enabled: true, mode: 'BLOCK', daysBefore: 5, daysAfter: 5 });
      await prisma.accountingPeriod.create({
        data: {
          organizationId: org.orgId,
          name: '2026-01',
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2026, 1, 1) - 1),
          status: 'CLOSED',
        },
      });

      await expect(guard(org.orgId, day('2026-01-20'))).rejects.toThrow(/closed\/locked/);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('stores what the guard reads — a saved policy round-trips through the parser', async () => {
    const org = await createTestOrg();
    try {
      await setPolicy(org.orgId, { enabled: true, mode: 'BLOCK', daysBefore: 45, daysAfter: null });
      expect(await loadTransactionDatePolicy(prisma, org.orgId)).toEqual({
        enabled: true,
        mode: 'BLOCK',
        daysBefore: 45,
        daysAfter: null,
      });
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
