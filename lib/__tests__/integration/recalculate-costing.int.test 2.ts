/**
 * Integration tests for the inventory costing-method switch
 * (src/app/api/v1/inventory/recalculate-costing/route.ts), run against the real
 * `<db>_test` database.
 *
 * BUG BEING PINNED: the switch posted its audit journal entry to two HARD-CODED
 * fake account ids ('costing-adjustment' / 'inventory-valuation-adjustment') that
 * are not real Account rows. JournalLine.account is a Restrict FK, so the
 * `tx.journalEntry.create` threw a Postgres FK violation, the whole
 * `$transaction` rolled back, and the `Organization.costingMethod` update + the
 * recreated lots all rolled back. The switch could never persist whenever the
 * method change produced a non-zero valuation delta.
 *
 * The route imports the shared `@/lib/prisma` client; the setupFiles entry
 * (setup-test-db-env.ts) repoints that client at `_test` before any module
 * loads, so handler writes and harness seeds hit the same DB.
 *
 * Run with:  npm run test:int -- recalculate-costing
 */
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  prisma,
  createTestOrg,
  createItem,
  assertTrialBalanced,
  journalEntryCount,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';
import { POST as recalculateCosting } from '@/src/app/api/v1/inventory/recalculate-costing/route';

afterAll(async () => {
  await disconnect();
});

const EFFECTIVE = '2026-03-20';
const EFFECTIVE_DATE = new Date(`${EFFECTIVE}T00:00:00.000Z`);

/** Build a NextRequest carrying the org header + JSON body the route reads. */
function buildRequest(orgId: string, body: unknown): NextRequest {
  const h = new Headers({ 'x-org-id': orgId, 'content-type': 'application/json' });
  return new NextRequest(new URL('http://localhost/api/v1/inventory/recalculate-costing'), {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
  });
}

/**
 * Seed two open FIFO cost layers at different unit costs so a FIFO→WA switch
 * collapses them into one weighted-average lot. The valuation delta is non-zero
 * because WA rounds the blended unit cost to money precision while the original
 * layers carry higher-precision costs (and, in general, the consolidation can
 * move value), which is exactly the case the bug rolled back.
 */
async function seedTwoLayers(org: TestOrg, itemId: string) {
  // 3 @ 1000.50 and 4 @ 1200.25 → WA = (3001.50 + 4801.00) / 7 = 1114.642857…
  await prisma.inventoryLot.create({
    data: {
      organizationId: org.orgId,
      itemId,
      warehouseId: org.warehouseId,
      documentType: 'ADJUSTMENT',
      documentId: 'SEED-A',
      date: new Date('2026-03-18T00:00:00.000Z'),
      qtyIn: 3,
      qtyOut: 0,
      qtyBalance: 3,
      unitCost: 1000.5,
    },
  });
  await prisma.inventoryLot.create({
    data: {
      organizationId: org.orgId,
      itemId,
      warehouseId: org.warehouseId,
      documentType: 'ADJUSTMENT',
      documentId: 'SEED-B',
      date: new Date('2026-03-19T00:00:00.000Z'),
      qtyIn: 4,
      qtyOut: 0,
      qtyBalance: 4,
      unitCost: 1200.25,
    },
  });
}

describe('inventory costing-method switch — posts to REAL accounts + period guard', () => {
  it('FIFO→WEIGHTED_AVERAGE persists the method, collapses lots, and posts a balanced JE on real accounts', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const itemId = await createItem(org.orgId);
    await seedTwoLayers(org, itemId);

    const jeBefore = await journalEntryCount(org.orgId);

    const res = await recalculateCosting(
      buildRequest(org.orgId, { newMethod: 'WEIGHTED_AVERAGE', effectiveDate: EFFECTIVE }),
    );

    // Before the fix: the FK violation rejects the whole transaction → 500.
    expect(res.status).toBe(200);

    // (1) The method switch PERSISTED (rolled back before the fix).
    const orgAfter = await prisma.organization.findUnique({
      where: { id: org.orgId },
      select: { costingMethod: true },
    });
    expect(orgAfter?.costingMethod).toBe('WEIGHTED_AVERAGE');

    // (2) Lots collapsed to a single WA lot.
    const lots = await prisma.inventoryLot.findMany({
      where: { organizationId: org.orgId, itemId, qtyBalance: { gt: 0 } },
    });
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].qtyBalance)).toBeCloseTo(7, 4);

    // (3) Exactly one new, balanced audit JE on REAL accounts.
    expect((await journalEntryCount(org.orgId)) - jeBefore).toBe(1);
    await assertTrialBalanced(org.orgId, 'costing switch');

    // (4) The JE lines reference resolvable accounts — never the fake ids.
    const lines = await prisma.journalLine.findMany({
      where: { entry: { organizationId: org.orgId } },
      select: { accountId: true },
    });
    const accountIds = lines.map((l) => l.accountId);
    expect(accountIds).not.toContain('costing-adjustment');
    expect(accountIds).not.toContain('inventory-valuation-adjustment');
    const realAccounts = await prisma.account.findMany({
      where: { organizationId: org.orgId },
      select: { id: true },
    });
    const realIds = new Set(realAccounts.map((a) => a.id));
    for (const id of accountIds) expect(realIds.has(id)).toBe(true);
    // Specifically the inventory + variance accounts the resolver should pick.
    expect(accountIds).toContain(org.accounts.inventoryAsset);

    await cleanupOrg(org.orgId);
  });

  it('refuses to post into a CLOSED period (422) and changes nothing', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const itemId = await createItem(org.orgId);
    await seedTwoLayers(org, itemId);

    await prisma.accountingPeriod.create({
      data: {
        organizationId: org.orgId,
        name: 'Mar 2026',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.000Z'),
        status: 'CLOSED',
      },
    });

    const jeBefore = await journalEntryCount(org.orgId);

    const res = await recalculateCosting(
      buildRequest(org.orgId, { newMethod: 'WEIGHTED_AVERAGE', effectiveDate: EFFECTIVE }),
    );

    expect(res.status).toBe(422);

    // Nothing changed: method still FIFO, lots untouched, no JE.
    const orgAfter = await prisma.organization.findUnique({
      where: { id: org.orgId },
      select: { costingMethod: true },
    });
    expect(orgAfter?.costingMethod).toBe('FIFO');
    expect(await journalEntryCount(org.orgId)).toBe(jeBefore);
    const lots = await prisma.inventoryLot.findMany({
      where: { organizationId: org.orgId, itemId, qtyBalance: { gt: 0 } },
    });
    expect(lots).toHaveLength(2);

    await cleanupOrg(org.orgId);
  });

  // Sanity: a switch with zero valuation delta still persists the method and
  // posts NO journal entry (no zero-value entry, no fake account).
  it('skips the JE entirely when the valuation delta is zero', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const itemId = await createItem(org.orgId);
    // Single layer at a clean cost → WA == FIFO, valueChange === 0.
    await prisma.inventoryLot.create({
      data: {
        organizationId: org.orgId,
        itemId,
        warehouseId: org.warehouseId,
        documentType: 'ADJUSTMENT',
        documentId: 'SEED-ZERO',
        date: new Date('2026-03-18T00:00:00.000Z'),
        qtyIn: 5,
        qtyOut: 0,
        qtyBalance: 5,
        unitCost: 1000,
      },
    });

    const jeBefore = await journalEntryCount(org.orgId);
    const res = await recalculateCosting(
      buildRequest(org.orgId, { newMethod: 'WEIGHTED_AVERAGE', effectiveDate: EFFECTIVE }),
    );

    expect(res.status).toBe(200);
    expect((await journalEntryCount(org.orgId)) - jeBefore).toBe(0);
    const orgAfter = await prisma.organization.findUnique({
      where: { id: org.orgId },
      select: { costingMethod: true },
    });
    expect(orgAfter?.costingMethod).toBe('WEIGHTED_AVERAGE');

    await cleanupOrg(org.orgId);
  });
});
