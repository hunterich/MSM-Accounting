/**
 * Concurrency invariants for two POSTING paths that historically did
 * `findFirst` (no row lock, READ COMMITTED) → check status → run a GL/inventory
 * side effect → plain `update` to mark done. With no atomic claim, two
 * concurrent calls (or a double-click) BOTH pass the status check and BOTH run
 * the side effect:
 *
 *   1. Stock-count post → two StockAdjustments + double inventory + double JE.
 *   2. Asset disposal    → two disposal JEs (double gain/loss posting).
 *
 * The fix mirrors `payment-void.ts` (`claimVoid`) and `approval/engine.ts`:
 * atomically CLAIM the terminal status with a guarded `updateMany` and assert
 * `count === 1` BEFORE the side effect. The losing transaction blocks on the
 * row lock, then sees the row already claimed → count 0 → 409.
 *
 * These tests drive the REAL route handlers (constructing a `NextRequest` with
 * the auth headers the routes read) so the actual wiring is exercised. The
 * `withHandler` wrapper never rejects — it returns a `NextResponse` whose
 * `status` is 200 on success and 409/422 on the conflict — so we tally by
 * `res.status`, not by `Promise.allSettled` rejection.
 *
 * Run with:  npm run test:int -- posting-concurrency
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST as postStockCountRoute } from '@/src/app/api/v1/stock-counts/[id]/post/route';
import { POST as disposeAssetRoute } from '@/src/app/api/v1/assets/[id]/dispose/route';
import {
  prisma,
  createTestOrg,
  createItem,
  assertTrialBalanced,
  journalEntryCount,
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
      fullName: 'Posting Tester',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  return user.id;
}

/**
 * Build a NextRequest carrying the auth headers the routes read. The actor is an
 * ADMIN (production middleware injects `x-role-type` from the verified JWT, which
 * makes the routes' `requirePermission` INV_ADJ/GL_JOURNAL check bypass).
 * Defaults to ADMIN so the concurrency assertions run; a caller may override.
 */
function authedRequest(
  url: string,
  headers: { orgId: string; userId?: string; roleType?: string },
  body?: unknown,
): NextRequest {
  const h = new Headers({ 'x-org-id': headers.orgId, 'x-role-type': headers.roleType ?? 'ADMIN' });
  if (headers.userId) h.set('x-user-id', headers.userId);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Tally the two route responses by HTTP status (handlers resolve, never reject). */
function tallyResponses(statuses: number[]) {
  const ok = statuses.filter((s) => s === 200 || s === 201).length;
  const conflict = statuses.filter((s) => s === 409 || s === 422).length;
  return { ok, conflict };
}

/**
 * The losing call may surface either status, and the race decides which:
 *   - 409 when the loser lost the atomic claim's row lock (the race guard fired); or
 *   - 422/400 when the loser's pre-claim read ran after the winner committed, so it
 *     saw the terminal state and rejected early.
 * Both prevent the double side-effect — the load-bearing assertion is the JE /
 * StockAdjustment count.
 */
function expectConflictStatus(status: number) {
  expect([400, 409, 422]).toContain(status);
}

/* ------------------------------------------------------------------ */
/* Fix 1 — Stock-count post double-posts inventory + GL                */
/* ------------------------------------------------------------------ */

describe('posting concurrency: stock-count post creates ONE adjustment + ONE JE', () => {
  it('two concurrent posts → one wins, one conflicts, exactly one StockAdjustment + one JE', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    const itemId = await createItem(org.orgId, 1000);

    // SUBMITTED count with a count-UP variance (live on-hand 0 → counted 13).
    // Posting must generate a StockAdjustment, write a cost layer, and post a
    // balanced variance JE.
    const count = await prisma.stockCount.create({
      data: {
        organizationId: org.orgId,
        number: 'SC-CONC-1',
        date: DATE,
        status: 'SUBMITTED',
        warehouseId: null,
        lines: {
          create: [
            { lineNo: 1, itemId, systemQty: 0, countedQty: 13, unitCost: 1000 },
          ],
        },
      },
      select: { id: true },
    });

    expect(await journalEntryCount(org.orgId)).toBe(0);

    // Fire two concurrent posts. Each runs in its own request/transaction so the
    // row lock taken by the atomic claim is what serializes them.
    const results = await Promise.allSettled([
      postStockCountRoute(
        authedRequest(`/api/v1/stock-counts/${count.id}/post`, { orgId: org.orgId, userId }),
        { params: Promise.resolve({ id: count.id }) },
      ),
      postStockCountRoute(
        authedRequest(`/api/v1/stock-counts/${count.id}/post`, { orgId: org.orgId, userId }),
        { params: Promise.resolve({ id: count.id }) },
      ),
    ]);

    // Handlers resolve to NextResponse; collect statuses.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const statuses = (results as PromiseFulfilledResult<Response>[]).map((r) => r.value.status);
    const { ok, conflict } = tallyResponses(statuses);
    expect(ok).toBe(1);
    expect(conflict).toBe(1);
    expectConflictStatus(statuses.find((s) => s !== 200 && s !== 201)!);

    // Exactly ONE StockAdjustment generated for this count (a double-post = 2).
    const adjustments = await prisma.stockAdjustment.findMany({
      where: { organizationId: org.orgId, reason: { contains: 'SC-CONC-1' } },
      select: { id: true },
    });
    expect(adjustments).toHaveLength(1);

    // Exactly ONE variance JE posted (a double-post would be 2).
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const after = await prisma.stockCount.findUnique({
      where: { id: count.id },
      select: { status: true, generatedAdjustmentId: true, postedAt: true },
    });
    expect(after?.status).toBe('POSTED');
    expect(after?.generatedAdjustmentId).toBe(adjustments[0].id);
    expect(after?.postedAt).toBeTruthy();

    const report = await assertTrialBalanced(org.orgId, 'stock-count post concurrency');
    expect(Math.abs(report.summary.endingDebit - report.summary.endingCredit)).toBeLessThanOrEqual(TOLERANCE);

    await cleanupOrg(org.orgId);
  });
});

/* ------------------------------------------------------------------ */
/* Fix 2 — Asset disposal double-posts gain/loss JE                    */
/* ------------------------------------------------------------------ */

async function seedDisposableAsset(org: TestOrg, opts: {
  acquisitionCost: number;
  accumulatedDepreciation: number;
  bookValue: number;
}): Promise<string> {
  const category = await prisma.assetCategory.create({
    data: {
      organizationId: org.orgId,
      name: `Cat-${Math.random().toString(36).slice(2, 8)}`,
      // Wire the JE accounts so disposal resolves deterministically.
      assetAccountId: org.accounts.inventoryAsset, // any postable Asset account
      accumDepAccountId: org.accounts.inventoryAdjustment, // postable; debited to clear accum dep
      depExpenseAccountId: org.accounts.cogsExpense,
    },
    select: { id: true },
  });
  const asset = await prisma.asset.create({
    data: {
      organizationId: org.orgId,
      assetNo: `AST-${Math.random().toString(36).slice(2, 8)}`,
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

describe('posting concurrency: asset disposal posts ONE gain/loss JE', () => {
  it('two concurrent disposes → one wins, one conflicts, exactly one disposal JE', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    // Cost 10000, accum dep 6000, book value 4000; proceeds == book value (4000)
    // so gainLoss is 0 — no gain/loss line is needed and the disposal JE balances
    // (Dr Cash 4000 + Dr AccumDep 6000 = Cr Asset 10000) using only the
    // category-wired accounts. (The route's keyword-based gain/loss account
    // resolver compares `a.type === 'Revenue'` against the uppercase enum
    // `'REVENUE'`, so it never resolves — a pre-existing, out-of-scope bug. A
    // zero-variance disposal still fully exercises the atomic claim + nextNumber
    // entryNo path under test here.)
    const assetId = await seedDisposableAsset(org, {
      acquisitionCost: 10000,
      accumulatedDepreciation: 6000,
      bookValue: 4000,
    });

    expect(await journalEntryCount(org.orgId)).toBe(0);

    const disposalBody = {
      disposalDate: '2026-06-23',
      disposalAmount: 4000,
      disposalMethod: 'SALE',
      notes: 'concurrency test',
    };

    const results = await Promise.allSettled([
      disposeAssetRoute(
        authedRequest(`/api/v1/assets/${assetId}/dispose`, { orgId: org.orgId, userId }, disposalBody),
        { params: Promise.resolve({ id: assetId }) },
      ),
      disposeAssetRoute(
        authedRequest(`/api/v1/assets/${assetId}/dispose`, { orgId: org.orgId, userId }, disposalBody),
        { params: Promise.resolve({ id: assetId }) },
      ),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const statuses = (results as PromiseFulfilledResult<Response>[]).map((r) => r.value.status);
    const { ok, conflict } = tallyResponses(statuses);
    expect(ok).toBe(1);
    expect(conflict).toBe(1);
    expectConflictStatus(statuses.find((s) => s !== 200 && s !== 201)!);

    // Exactly ONE disposal JE (a double-post would be 2).
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const after = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { status: true, disposalDate: true, disposalAmount: true, disposalGainLoss: true },
    });
    expect(after?.status).toBe('DISPOSED');
    expect(after?.disposalDate).toBeTruthy();
    expect(Number(after?.disposalGainLoss)).toBeCloseTo(0, 2);

    const report = await assertTrialBalanced(org.orgId, 'asset disposal concurrency');
    expect(Math.abs(report.summary.endingDebit - report.summary.endingCredit)).toBeLessThanOrEqual(TOLERANCE);

    await cleanupOrg(org.orgId);
  });
});
