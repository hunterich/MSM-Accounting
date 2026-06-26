/**
 * Regression: a DRAFT stock adjustment must NOT post to inventory/GL.
 *
 * Finding 2 — the create route posted whenever `!routed && lines.length > 0`,
 * and `routed` is only computed for non-DRAFT statuses, so a DRAFT adjustment
 * with lines fell straight through to `postStockAdjustmentToLedger` and moved
 * the ledger + booked a journal entry. The fix gates posting on a live status
 * (`adj.status === 'APPROVED' && !routed`).
 *
 * Drives the real stock-adjustments POST route against the test DB.
 * Run with:  npm run test:int -- stock-adjustment-draft-posting
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postStockAdjustment } from '@/src/app/api/v1/stock-adjustments/route';
import {
  prisma,
  createTestOrg,
  createItem,
  assertTrialBalanced,
  accountBalance,
  inventoryLedgerValue,
  inventoryLotValue,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = '2026-03-15';

function makePost(orgId: string, body: unknown): NextRequest {
  return new NextRequest(new URL('/api/v1/stock-adjustments', 'http://localhost'), {
    method: 'POST',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `adj-creator-${randomUUID()}`,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    body: JSON.stringify({ ...(body as object), organizationId: orgId }),
  });
}

/** An increase line: +10 units @ 1000. */
function increaseLine(itemId: string) {
  return { itemId, oldQty: 0, newQty: 10, qtyDiff: 10, unitCost: 1000, totalValue: 10000 };
}

describe('stock adjustment posting gate', () => {
  it('does NOT post a DRAFT adjustment to inventory/GL', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    const res = await postStockAdjustment(
      makePost(org.orgId, { date: DATE, type: 'QUANTITY', reason: 'cycle count', status: 'DRAFT', lines: [increaseLine(itemId)] }),
    );
    expect(res.status).toBe(201);

    // The draft was persisted with its lines...
    const adj = await prisma.stockAdjustment.findFirst({
      where: { organizationId: org.orgId },
      select: { id: true, status: true, lines: { select: { id: true } } },
    });
    expect(adj?.status).toBe('DRAFT');
    expect(adj?.lines.length).toBe(1);

    // ...but nothing touched the ledger / GL / cost layers.
    expect(await journalEntryCount(org.orgId)).toBe(0);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(0, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(0, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(0, 2);

    await cleanupOrg(org.orgId);
  });

  it('posts an APPROVED adjustment to inventory/GL (no approval requirement configured)', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    const res = await postStockAdjustment(
      makePost(org.orgId, { date: DATE, type: 'QUANTITY', reason: 'cycle count', status: 'APPROVED', lines: [increaseLine(itemId)] }),
    );
    expect(res.status).toBe(201);

    const adj = await prisma.stockAdjustment.findFirst({
      where: { organizationId: org.orgId },
      select: { status: true },
    });
    expect(adj?.status).toBe('APPROVED');

    // Inventory increase: Dr Inventory 10000 / Cr Variance 10000.
    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(10000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(10000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(10000, 2);
    await assertTrialBalanced(org.orgId, 'approved adjustment');

    await cleanupOrg(org.orgId);
  });
});
