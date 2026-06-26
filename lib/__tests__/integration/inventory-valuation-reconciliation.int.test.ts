/**
 * Regression: inventory valuation REPORTING must reconcile with the GL inventory
 * account under weighted-average costing.
 *
 * Finding 5b — the valuation report summed open cost layers
 * (`qtyBalance × unitCost`). Under WA the layers keep their original per-layer
 * costs while the ledger/GL relieve consumption at the blended rate, so lot-sum
 * diverges from GL (the pre-existing model gap pinned by an `it.fails` in
 * stock-adjustment-invariants). The fix derives reported value from the same
 * immutable ledger the GL is posted from (`computeLedgerValuation`), so the
 * report reconciles to GL by construction for both FIFO and WA.
 *
 * Run with:  npm run test:int -- inventory-valuation-reconciliation
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { computeLedgerValuation } from '../../inventory-valuation';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { postBillToLedger } from '../../bill-posting';
import { GET as getValuation } from '@/src/app/api/v1/inventory/valuation/route';
import {
  prisma,
  createTestOrg,
  createVendor,
  createItem,
  accountBalance,
  inventoryLedgerValue,
  inventoryLotValue,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE_A = new Date('2026-03-18T00:00:00.000Z');
const DATE_B = new Date('2026-03-19T00:00:00.000Z');
const DATE_C = new Date('2026-03-20T00:00:00.000Z');

let billSeq = 0;
async function receiveStock(org: TestOrg, itemId: string, qty: number, unitCost: number, date: Date) {
  billSeq += 1;
  const vendorId = await createVendor(org.orgId);
  const bill = await prisma.bill.create({
    data: { organizationId: org.orgId, number: `BILL-${billSeq}-${randomUUID().slice(0, 6)}`, vendorId, issueDate: date, status: 'OPEN' },
    select: { id: true, number: true },
  });
  await prisma.$transaction((tx) =>
    postBillToLedger(tx, org.orgId, {
      id: bill.id, number: bill.number, issueDate: date, apAccountId: null,
      taxable: false, taxInclusive: false, taxRate: 0,
      lines: [{ id: 'l1', itemId, quantity: qty, price: unitCost, lineTotal: qty * unitCost, purchaseOrderLineId: null }],
    }),
  );
}

function makeGet(orgId: string): NextRequest {
  return new NextRequest(new URL('/api/v1/inventory/valuation', 'http://localhost'), {
    method: 'GET',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `valuation-reader-${randomUUID()}`,
      'x-role-type': 'ADMIN',
    }),
  });
}

describe('inventory valuation reconciles to GL (weighted-average)', () => {
  it('ledger-derived valuation equals the GL inventory account after a WA decrease', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    const itemId = await createItem(org.orgId, 1000);

    // Two receipts → 10 units, WA = 1100. Ledger/GL/lots all = 11000 so far.
    await receiveStock(org, itemId, 5, 1000, DATE_A);
    await receiveStock(org, itemId, 5, 1200, DATE_B);

    // Decrease 4 @ WA(1100) = 4400 → ledger/GL = 6600, but lot-sum stays 7000.
    await prisma.$transaction((tx) =>
      postStockAdjustmentToLedger(tx, org.orgId, {
        id: `adj-${randomUUID().slice(0, 8)}`, number: 'ADJ-WA', date: DATE_C, warehouseId: null,
        lines: [{ itemId, oldQty: 10, newQty: 6, unitCost: 9999 }],
      }),
    );

    const glInventory = await accountBalance(org.orgId, org.accounts.inventoryAsset);
    const ledger = await inventoryLedgerValue(org.orgId);
    const lots = await inventoryLotValue(org.orgId);
    expect(glInventory).toBeCloseTo(6600, 2);
    expect(ledger).toBeCloseTo(6600, 2);
    expect(lots).toBeCloseTo(7000, 2); // lot-sum diverges under WA (the documented gap)

    // The ledger-derived valuation reconciles to GL (NOT to the diverging lot-sum).
    const valuation = await computeLedgerValuation(prisma, org.orgId);
    const item = valuation.get(itemId);
    expect(item?.totalQty).toBeCloseTo(6, 4);
    expect(item?.totalValue).toBeCloseTo(6600, 2);
    const total = [...valuation.values()].reduce((s, v) => s + v.totalValue, 0);
    expect(total).toBeCloseTo(glInventory, 2);
    expect(total).toBeCloseTo(ledger, 2);

    await cleanupOrg(org.orgId);
  });

  it('the valuation report endpoint returns the GL-reconciled total under WA', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    const itemId = await createItem(org.orgId, 1000);

    await receiveStock(org, itemId, 5, 1000, DATE_A);
    await receiveStock(org, itemId, 5, 1200, DATE_B);
    await prisma.$transaction((tx) =>
      postStockAdjustmentToLedger(tx, org.orgId, {
        id: `adj-${randomUUID().slice(0, 8)}`, number: 'ADJ-WA-2', date: DATE_C, warehouseId: null,
        lines: [{ itemId, oldQty: 10, newQty: 6, unitCost: 9999 }],
      }),
    );

    const res = await getValuation(makeGet(org.orgId));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Report total ties to GL (6600), not the diverging lot-sum (7000).
    expect(body.summary.totalValue).toBeCloseTo(6600, 2);
    const row = body.items.find((i: { itemId: string }) => i.itemId === itemId);
    expect(row.totalQty).toBeCloseTo(6, 4);
    expect(row.totalValue).toBeCloseTo(6600, 2);

    await cleanupOrg(org.orgId);
  });
});
