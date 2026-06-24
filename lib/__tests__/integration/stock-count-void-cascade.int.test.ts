/**
 * Integration: voiding the StockAdjustment that a posted Stock Count generated
 * must cascade back to the count. Against a real Postgres DB, this exercises the
 * full path the void route runs (voidStockAdjustment → voidStockCountForAdjustment
 * in one transaction) and asserts:
 *   - the adjustment is VOID and the owning count is VOIDED (not left POSTED),
 *   - GL + inventory are reversed (trial balanced, lots = ledger, value restored),
 *   - the count's /journal route returns null afterwards (was returning the
 *     superseded POSTED entry — the bug this fixes).
 *
 * Run with: npm run test:int   (test DB needs StockAdjustmentStatus 'VOID' and
 * StockCountStatus 'VOIDED' — applied via npm run test:int:setup)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { postStockCount } from '../../stock-count-posting';
import { postBillToLedger } from '../../bill-posting';
import { voidStockAdjustment } from '../../stock-adjustment-void';
import { voidStockCountForAdjustment } from '../../stock-count-void';
import { GET as journalRoute } from '../../../src/app/api/v1/stock-counts/[id]/journal/route';
import {
  prisma, createTestOrg, createVendor, createItem,
  assertTrialBalanced, assertInventoryReconciled, accountBalance,
  inventoryLedgerValue, inventoryLotValue, journalEntryCount,
  cleanupOrg, disconnect, type TestOrg,
} from './harness';

afterAll(async () => { await disconnect(); });

const DATE = new Date('2026-06-23T00:00:00.000Z');

let billSeq = 0;
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number) {
  billSeq += 1;
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-VC-${billSeq}`, vendorId, issueDate: DATE, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) => postBillToLedger(tx, org.orgId, {
    id: bill.id, number: bill.number, issueDate: DATE, apAccountId: null,
    taxable: false, taxInclusive: false, taxRate: 0,
    lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
  }));
}

async function onHand(orgId: string, itemId: string) {
  const r = await prisma.inventoryLot.aggregate({ where: { organizationId: orgId, itemId }, _sum: { qtyBalance: true } });
  return Number(r._sum.qtyBalance ?? 0);
}

/** Post a SUBMITTED count exactly as the post route does: generate the adjustment, then mark POSTED + link it. */
async function postCount(org: TestOrg, countId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.findFirstOrThrow({
      where: { id: countId, organizationId: org.orgId },
      include: { lines: { select: { itemId: true, systemQty: true, countedQty: true, unitCost: true } } },
    });
    const adjId = await postStockCount(tx, org.orgId, {
      id: count.id, number: count.number, date: count.date, warehouseId: count.warehouseId,
      lines: count.lines.map((l) => ({ itemId: l.itemId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
    });
    await tx.stockCount.update({ where: { id: countId }, data: { status: 'POSTED', postedAt: DATE, generatedAdjustmentId: adjId } });
    return adjId!;
  });
}

function journalReq(countId: string, orgId: string) {
  return journalRoute(
    new NextRequest(`http://localhost/api/v1/stock-counts/${countId}/journal`, { headers: { 'x-org-id': orgId } }),
    { params: Promise.resolve({ id: countId }) },
  );
}

describe('stock count void cascade (adjustment void → count VOIDED)', () => {
  it('voiding the generated adjustment voids the count and nulls its journal', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId, 1000);
    await receiveStock(org, itemId, 10, 1000); // on-hand 10, lots/ledger/GL = 10000

    const count = await prisma.stockCount.create({
      data: {
        organizationId: org.orgId, number: 'SC-VC-1', date: DATE, status: 'SUBMITTED', warehouseId: null,
        lines: { create: [{ lineNo: 1, itemId, systemQty: 10, countedQty: 7, unitCost: 1000 }] },
      },
      select: { id: true },
    });

    const adjId = await postCount(org, count.id);
    expect(adjId).toBeTruthy();
    expect(await onHand(org.orgId, itemId)).toBeCloseTo(7, 4);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(7000, 2);
    await assertTrialBalanced(org.orgId, 'count posted');
    await assertInventoryReconciled(org.orgId, 'count posted');

    // Before void, /journal resolves the posted variance entry.
    const before = await journalReq(count.id, org.orgId);
    expect(before.status).toBe(200);
    expect(await before.json()).not.toBeNull();

    // Void the generated adjustment exactly as the void route does.
    await prisma.$transaction(async (tx) => {
      await voidStockAdjustment(tx, org.orgId, adjId, { date: DATE });
      const voidedCountId = await voidStockCountForAdjustment(tx, org.orgId, adjId);
      expect(voidedCountId).toBe(count.id);
    });

    // Adjustment VOID, count VOIDED (not left POSTED), link kept for audit.
    const adj = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adjId }, select: { status: true } });
    expect(adj.status).toBe('VOID');
    const after = await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id }, select: { status: true, generatedAdjustmentId: true } });
    expect(after.status).toBe('VOIDED');
    expect(after.generatedAdjustmentId).toBe(adjId);

    // GL + inventory back to the pre-count state, reconciled.
    await assertTrialBalanced(org.orgId, 'count voided');
    await assertInventoryReconciled(org.orgId, 'count voided');
    expect(await onHand(org.orgId, itemId)).toBeCloseTo(10, 4);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(10000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(10000, 2);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(10000, 2);
    expect(await journalEntryCount(org.orgId)).toBe(3); // bill receipt + variance + reversal

    // The fix: /journal now returns null instead of the superseded posted entry.
    const afterJournal = await journalReq(count.id, org.orgId);
    expect(afterJournal.status).toBe(200);
    expect(await afterJournal.json()).toBeNull();

    await cleanupOrg(org.orgId);
  });
});
