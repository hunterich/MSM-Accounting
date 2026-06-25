/**
 * Asset-posting GL invariants (real Postgres).
 *
 * Covers two correctness bugs in the asset module:
 *
 *   Fix 4 — Asset disposal gain/loss account never resolved. The disposal route's
 *   keyword account resolver filtered by `a.type === 'Revenue'` / `'Expense'`
 *   (capitalised), but the Prisma `AccountType` enum is uppercase
 *   (`'REVENUE'` / `'EXPENSE'`). So a keyword-resolved gain/loss account never
 *   matched → the non-zero gain/loss line was dropped → the disposal JE was
 *   UNBALANCED. These tests dispose for a non-zero GAIN and a non-zero LOSS and
 *   assert the gain/loss line posts on the correct account AND the JE balances.
 *
 *   Fix 1 — Depreciation run had no period guard, so it could post a POSTED
 *   depreciation JE into a CLOSED accounting period. This test runs depreciation
 *   for a month that falls inside a CLOSED period and asserts it throws (422) and
 *   writes nothing.
 *
 * These drive the REAL route handlers (constructing a NextRequest with the auth
 * headers the routes read), so the actual wiring is exercised.
 *
 * Run with:  npm run test:int -- asset-posting
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST as disposeAssetRoute } from '@/src/app/api/v1/assets/[id]/dispose/route';
import { POST as runDepreciationRoute } from '@/src/app/api/v1/assets/depreciation/run/route';
import {
  prisma,
  createTestOrg,
  assertTrialBalanced,
  journalEntryCount,
  accountBalance,
  cleanupOrg,
  disconnect,
  TOLERANCE,
  type TestOrg,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-23T00:00:00.000Z');

/** Seed a real User so the routes' fire-and-forget audit log resolves its FK. */
async function seedUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.local`,
      fullName: 'Asset Tester',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  return user.id;
}

/**
 * Build a NextRequest carrying the auth headers the routes read. The actor is an
 * ADMIN (production middleware injects `x-role-type: 'ADMIN'` from the verified
 * JWT, which makes the routes' `requirePermission` GL_JOURNAL check bypass).
 */
function authedRequest(
  url: string,
  headers: { orgId: string; userId?: string },
  body?: unknown,
): NextRequest {
  const h = new Headers({ 'x-org-id': headers.orgId, 'x-role-type': 'ADMIN' });
  if (headers.userId) h.set('x-user-id', headers.userId);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Seed a postable Revenue gain account + Expense loss account so the disposal
 * route's keyword resolver can find them. The names contain the keywords the
 * route searches for ('gain on disposal' / 'loss on disposal').
 */
async function seedGainLossAccounts(orgId: string): Promise<{ gainId: string; lossId: string }> {
  const gain = await prisma.account.create({
    data: {
      organizationId: orgId,
      code: `49${Math.floor(Math.random() * 90 + 10)}`,
      name: 'Gain on disposal of assets',
      type: 'REVENUE',
      normalSide: 'CREDIT',
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  const loss = await prisma.account.create({
    data: {
      organizationId: orgId,
      code: `59${Math.floor(Math.random() * 90 + 10)}`,
      name: 'Loss on disposal of assets',
      type: 'EXPENSE',
      normalSide: 'DEBIT',
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  return { gainId: gain.id, lossId: loss.id };
}

/**
 * Seed an ACTIVE disposable asset. The category wires asset + accum-dep
 * accounts, but NOT a gain/loss account — so gain/loss must resolve via the
 * keyword resolver (the path Fix 4 repairs).
 */
async function seedDisposableAsset(org: TestOrg, opts: {
  acquisitionCost: number;
  accumulatedDepreciation: number;
  bookValue: number;
}): Promise<string> {
  const category = await prisma.assetCategory.create({
    data: {
      organizationId: org.orgId,
      name: `Cat-${randomUUID().slice(0, 8)}`,
      assetAccountId: org.accounts.inventoryAsset, // any postable Asset account
      accumDepAccountId: org.accounts.inventoryAdjustment, // postable; debited to clear accum dep
      depExpenseAccountId: org.accounts.cogsExpense,
    },
    select: { id: true },
  });
  const asset = await prisma.asset.create({
    data: {
      organizationId: org.orgId,
      assetNo: `AST-${randomUUID().slice(0, 8)}`,
      name: 'Test Machine',
      categoryId: category.id,
      acquisitionDate: DATE,
      acquisitionCost: opts.acquisitionCost,
      accumulatedDepreciation: opts.accumulatedDepreciation,
      bookValue: opts.bookValue,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  return asset.id;
}

/* ------------------------------------------------------------------ */
/* Fix 4 — disposal gain/loss account resolves; JE balances           */
/* ------------------------------------------------------------------ */

describe('asset disposal: non-zero GAIN posts the gain line on a Revenue account, JE balances', () => {
  it('proceeds > book value → gain line credited; disposal JE balanced', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    const { gainId } = await seedGainLossAccounts(org.orgId);

    // Cost 10000, accum dep 6000, book value 4000. Proceeds 7000 → gain 3000.
    const assetId = await seedDisposableAsset(org, {
      acquisitionCost: 10000,
      accumulatedDepreciation: 6000,
      bookValue: 4000,
    });

    expect(await journalEntryCount(org.orgId)).toBe(0);

    const res = await disposeAssetRoute(
      authedRequest(
        `/api/v1/assets/${assetId}/dispose`,
        { orgId: org.orgId, userId },
        { disposalDate: '2026-06-23', disposalAmount: 7000, disposalMethod: 'SALE', notes: 'gain case' },
      ),
      { params: Promise.resolve({ id: assetId }) },
    );
    expect(res.status).toBe(200);

    // Exactly one disposal JE, and it must balance (the bug dropped the gain line).
    expect(await journalEntryCount(org.orgId)).toBe(1);
    const report = await assertTrialBalanced(org.orgId, 'disposal gain');
    expect(Math.abs(report.summary.endingDebit - report.summary.endingCredit)).toBeLessThanOrEqual(TOLERANCE);

    // The gain account carries a 3000 credit (negative debit-positive balance).
    expect(await accountBalance(org.orgId, gainId)).toBeCloseTo(-3000, 2);

    // The JE actually has a line on the gain account.
    const lines = await prisma.journalLine.findMany({
      where: { entry: { organizationId: org.orgId, status: 'POSTED' }, accountId: gainId },
      select: { credit: true, debit: true },
    });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].credit)).toBeCloseTo(3000, 2);

    await cleanupOrg(org.orgId);
  });
});

describe('asset disposal: non-zero LOSS posts the loss line on an Expense account, JE balances', () => {
  it('proceeds < book value → loss line debited; disposal JE balanced', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    const { lossId } = await seedGainLossAccounts(org.orgId);

    // Cost 10000, accum dep 6000, book value 4000. Proceeds 1500 → loss 2500.
    const assetId = await seedDisposableAsset(org, {
      acquisitionCost: 10000,
      accumulatedDepreciation: 6000,
      bookValue: 4000,
    });

    expect(await journalEntryCount(org.orgId)).toBe(0);

    const res = await disposeAssetRoute(
      authedRequest(
        `/api/v1/assets/${assetId}/dispose`,
        { orgId: org.orgId, userId },
        { disposalDate: '2026-06-23', disposalAmount: 1500, disposalMethod: 'SALE', notes: 'loss case' },
      ),
      { params: Promise.resolve({ id: assetId }) },
    );
    expect(res.status).toBe(200);

    expect(await journalEntryCount(org.orgId)).toBe(1);
    const report = await assertTrialBalanced(org.orgId, 'disposal loss');
    expect(Math.abs(report.summary.endingDebit - report.summary.endingCredit)).toBeLessThanOrEqual(TOLERANCE);

    // The loss account carries a 2500 debit (positive debit-positive balance).
    expect(await accountBalance(org.orgId, lossId)).toBeCloseTo(2500, 2);

    const lines = await prisma.journalLine.findMany({
      where: { entry: { organizationId: org.orgId, status: 'POSTED' }, accountId: lossId },
      select: { credit: true, debit: true },
    });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].debit)).toBeCloseTo(2500, 2);

    await cleanupOrg(org.orgId);
  });
});

/* ------------------------------------------------------------------ */
/* Fix 1 — depreciation run respects the period lock                  */
/* ------------------------------------------------------------------ */

/** Seed an ACTIVE asset that depreciates a non-zero amount in the target month. */
async function seedDepreciableAsset(org: TestOrg): Promise<string> {
  const category = await prisma.assetCategory.create({
    data: {
      organizationId: org.orgId,
      name: `DepCat-${randomUUID().slice(0, 8)}`,
      depExpenseAccountId: org.accounts.cogsExpense,
      accumDepAccountId: org.accounts.inventoryAdjustment,
    },
    select: { id: true },
  });
  const asset = await prisma.asset.create({
    data: {
      organizationId: org.orgId,
      assetNo: `DEP-${randomUUID().slice(0, 8)}`,
      name: 'Depreciable Machine',
      categoryId: category.id,
      acquisitionDate: new Date('2026-01-01T00:00:00.000Z'),
      acquisitionCost: 12000,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 12,
      salvageValue: 0,
      accumulatedDepreciation: 0,
      bookValue: 12000,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  return asset.id;
}

describe('asset depreciation: run into a CLOSED period throws and posts nothing', () => {
  it('closed period blocks the depreciation run; no JE, no AssetDepreciation', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    const assetId = await seedDepreciableAsset(org);

    // Depreciation posts on the 28th of the month → close the period covering Mar 2026.
    await prisma.accountingPeriod.create({
      data: {
        organizationId: org.orgId,
        name: 'Mar 2026',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.000Z'),
        status: 'CLOSED',
      },
    });

    expect(await journalEntryCount(org.orgId)).toBe(0);

    const res = await runDepreciationRoute(
      authedRequest(
        '/api/v1/assets/depreciation/run',
        { orgId: org.orgId, userId },
        { month: 3, year: 2026 },
      ),
    );

    // Period guard rejects with 422 (closed/locked).
    expect(res.status).toBe(422);
    const payload = await res.json();
    expect(String(payload.error)).toMatch(/closed|locked/i);

    // Nothing was written.
    expect(await journalEntryCount(org.orgId)).toBe(0);
    const dep = await prisma.assetDepreciation.findMany({ where: { organizationId: org.orgId } });
    expect(dep).toHaveLength(0);
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { accumulatedDepreciation: true, lastDepreciationDate: true },
    });
    expect(Number(asset?.accumulatedDepreciation)).toBeCloseTo(0, 2);
    expect(asset?.lastDepreciationDate).toBeNull();

    await cleanupOrg(org.orgId);
  });
});
