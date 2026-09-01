/**
 * The opening-balance paths obey the period lock.
 *
 * These four writes were the ones the period-guard policy gate found
 * unguarded: opening stock on item create/update, the CSV opening-balance
 * journal, the migration cutover journal, and marketplace settlement posting.
 * Every one is a POSTED entry, so a closed month should refuse it.
 *
 * The policy gate only matches text — it cannot tell that a guard is on the
 * right date, or that it fires at all. These tests do, against a real database.
 *
 * Run with:  npm run test:int -- opening-period-guard
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postOpeningStockIfNeeded } from '../../inventory-opening';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

const IN_PERIOD = new Date('2026-04-15T00:00:00.000Z');

async function definePeriod(
  orgId: string,
  state: { status: 'OPEN' | 'CLOSED'; isLocked?: boolean },
): Promise<void> {
  await prisma.accountingPeriod.create({
    data: {
      organizationId: orgId,
      name: '2026-04',
      startDate: new Date(Date.UTC(2026, 3, 1)),
      endDate: new Date(Date.UTC(2026, 4, 1) - 1),
      status: state.status,
      isLocked: state.isLocked ?? false,
    },
  });
}

async function makeItem(org: TestOrg, sku: string, qty = 10, cost = 150_000): Promise<string> {
  const item = await prisma.item.create({
    data: {
      organizationId: org.orgId,
      sku,
      name: `Item ${sku}`,
      type: 'PRODUCT',
      unit: 'PCS',
      sellingPrice: cost * 2,
      costPrice: cost,
      openingStock: qty,
    },
    select: { id: true },
  });
  return item.id;
}

/** `postOpeningStockIfNeeded` posts through `postJournalEntry`, whose source
 *  defaults to SYSTEM — so count by the memo it writes, not by source. */
const openingEntries = (orgId: string) =>
  prisma.journalEntry.count({
    where: { organizationId: orgId, memo: { startsWith: 'Opening stock:' } },
  });

describe('opening stock respects the period lock', () => {
  it('posts normally when the period is open', async () => {
    const org = await createTestOrg();
    try {
      await definePeriod(org.orgId, { status: 'OPEN' });
      const itemId = await makeItem(org, 'OPEN-OK');

      await prisma.$transaction((tx) => postOpeningStockIfNeeded(tx, org.orgId, itemId, IN_PERIOD));

      expect(await openingEntries(org.orgId)).toBe(1);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('is refused when the period is closed, and writes nothing', async () => {
    const org = await createTestOrg();
    try {
      await definePeriod(org.orgId, { status: 'CLOSED' });
      const itemId = await makeItem(org, 'CLOSED-NO');

      await expect(
        prisma.$transaction((tx) => postOpeningStockIfNeeded(tx, org.orgId, itemId, IN_PERIOD)),
      ).rejects.toThrow(/closed\/locked/i);

      // The transaction rolls back, so the cost layer must not survive either —
      // opening stock is a lot AND a journal, and half of it is worse than none.
      expect(await openingEntries(org.orgId)).toBe(0);
      expect(
        await prisma.inventoryLot.count({ where: { organizationId: org.orgId, itemId } }),
      ).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('is refused when the period is merely locked, not closed', async () => {
    const org = await createTestOrg();
    try {
      await definePeriod(org.orgId, { status: 'OPEN', isLocked: true });
      const itemId = await makeItem(org, 'LOCKED-NO');

      await expect(
        prisma.$transaction((tx) => postOpeningStockIfNeeded(tx, org.orgId, itemId, IN_PERIOD)),
      ).rejects.toThrow(/closed\/locked/i);
      expect(await openingEntries(org.orgId)).toBe(0);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('posts on a date no period covers — an undefined period is not yet closed', async () => {
    const org = await createTestOrg();
    try {
      await definePeriod(org.orgId, { status: 'CLOSED' });
      const itemId = await makeItem(org, 'OUTSIDE-OK');

      // June, outside the only defined (and closed) period.
      await prisma.$transaction((tx) =>
        postOpeningStockIfNeeded(tx, org.orgId, itemId, new Date('2026-06-10T00:00:00.000Z')),
      );

      expect(await openingEntries(org.orgId)).toBe(1);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  /**
   * The guard sits after the `postGl` early return on purpose. Migration writes
   * the perpetual lot without a journal — the migrated trial balance already
   * carries the inventory-asset balance — so there is no ledger write to guard,
   * and a closed cutover month must not block the stock import.
   */
  it('still imports the cost layer with postGl:false, even in a closed period', async () => {
    const org = await createTestOrg();
    try {
      await definePeriod(org.orgId, { status: 'CLOSED' });
      const itemId = await makeItem(org, 'MIGRATION-OK');

      await prisma.$transaction((tx) =>
        postOpeningStockIfNeeded(tx, org.orgId, itemId, IN_PERIOD, { postGl: false }),
      );

      expect(await openingEntries(org.orgId)).toBe(0);
      expect(
        await prisma.inventoryLot.count({ where: { organizationId: org.orgId, itemId } }),
      ).toBe(1);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});
