import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { addCostLayer, getWeightedAverageCost, lockInventoryItems, relieveCostLayers } from '@/lib/inventory-costing';
import { voidInvoice } from '@/lib/invoice-void';
import { prisma, createTestOrg, createCustomer, createVendor, createItem, cleanupOrg, disconnect,
  accountBalance, inventoryLedgerValue, assertTrialBalanced } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-09-10');

async function stock() {
  const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
  const itemId = await createItem(org.orgId, 1000);
  const vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
  for (const [number, price] of [['B-1000', 1000], ['B-1200', 1200]] as const) {
    const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: DATE,
      status: 'OPEN', subtotal: 5 * price, totalAmount: 5 * price,
      lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 5, price, lineTotal: 5 * price } } }, include: { lines: true } });
    await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  }
  return { org, itemId, customerId };
}
type Stock = Awaited<ReturnType<typeof stock>>;
async function saleDocument(f: Stock, quantity: number, number: string) {
  return prisma.salesInvoice.create({ data: { organizationId: f.org.orgId, customerId: f.customerId,
    number, issueDate: new Date('2026-09-11'), status: 'SENT', subtotal: quantity * 3000, totalAmount: quantity * 3000,
    lines: { create: { itemId: f.itemId, lineNo: 1, description: 'Stock', quantity, price: 3000, lineSubtotal: quantity * 3000 } } } });
}
async function sell(f: Stock, quantity: number, number: string) {
  const invoice = await saleDocument(f, quantity, number);
  await prisma.$transaction(tx => postInvoiceSend(tx, f.org.orgId, invoice.id));
  return invoice.id;
}

describe('INV-02: moving-average cost follows the remaining book-value pool', () => {
  it('selling some stock does not change the average when no new value enters the pool', async () => {
    const f = await stock();
    try {
      // Receive 5 × 1000 + 5 × 1200 = 11000 for 10 units; sell 4 × 1100.
      await sell(f, 4, 'SALE-ONE');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(6600);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(6600);
      const nextCost = await prisma.$transaction(tx => getWeightedAverageCost(tx, f.org.orgId, f.itemId, null));
      expect(nextCost).toBe(1100);
      const receiptLots = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { unitCost: 'asc' } });
      expect(receiptLots.map(lot => Number(lot.unitCost))).toEqual([1000, 1200]);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('several partial sales exhaust the original inventory value exactly', async () => {
    const f = await stock();
    try {
      for (const [quantity, number] of [[4, 'SALE-A'], [4, 'SALE-B'], [2, 'SALE-C']] as const) {
        await sell(f, quantity, number);
      }
      const lots = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId, itemId: f.itemId } });
      expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(0);
      const measured = {
        quantity: lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0),
        inventoryLedger: await inventoryLedgerValue(f.org.orgId),
        inventoryGl: await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset),
        cogsGl: await accountBalance(f.org.orgId, f.org.accounts.cogsExpense),
      };
      // Expected totals are receipt arithmetic, independent of the costing code.
      expect(measured).toEqual({ quantity: 0, inventoryLedger: 0, inventoryGl: 0, cogsGl: 11000 });
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('simultaneous partial sales share the same booked pool and exhaust it once', async () => {
    const f = await stock();
    try {
      const first = await saleDocument(f, 4, 'CONCURRENT-A');
      const second = await saleDocument(f, 6, 'CONCURRENT-B');
      let ready!: () => void, release!: () => void, identify!: (pid: number) => void;
      const started = new Promise<void>(done => { ready = done; });
      const hold = new Promise<void>(done => { release = done; });
      const identified = new Promise<number>(done => { identify = done; });
      const a = prisma.$transaction(async tx => {
        await postInvoiceSend(tx, f.org.orgId, first.id); ready(); await hold;
      }, { timeout: 15000 });
      const settledA = a.then(() => null, error => error);
      let settledB: Promise<unknown> | undefined;
      try {
        await Promise.race([started, a.then(() => { throw new Error('First sale did not wait'); })]);
        const b = prisma.$transaction(async tx => {
          const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          identify(rows[0].pid); await postInvoiceSend(tx, f.org.orgId, second.id);
        }, { timeout: 15000 });
        settledB = b.then(() => null, error => error);
        const pid = await identified;
        let blocked = false;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
          if (rows[0].blocked) { blocked = true; break; }
          await new Promise(done => setTimeout(done, 10));
        }
        expect(blocked).toBe(true);
      } finally { release(); await settledA; if (settledB) await settledB; }
      expect(await settledA).toBeNull();
      expect(await settledB).toBeNull();
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(11000);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('void restores the recorded sale value and subsequent sales consume that value', async () => {
    const f = await stock();
    try {
      const first = await sell(f, 4, 'TO-VOID');
      await sell(f, 2, 'KEEP');
      await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, first, { date: new Date('2026-09-12') }));
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(8800);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(8800);
      expect(await prisma.$transaction(tx => getWeightedAverageCost(tx, f.org.orgId, f.itemId, null))).toBe(1100);
      await sell(f, 8, 'AFTER-VOID');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(11000);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('a later receipt changes the average from the remaining book value', async () => {
    const f = await stock();
    try {
      await sell(f, 4, 'BEFORE-RECEIPT');
      const vendorId = await createVendor(f.org.orgId);
      const bill = await prisma.bill.create({ data: { organizationId: f.org.orgId, vendorId, number: 'NEW-RECEIPT',
        issueDate: DATE, status: 'OPEN', totalAmount: 8400,
        lines: { create: { itemId: f.itemId, lineNo: 1, description: 'Stock', quantity: 6, price: 1400, lineTotal: 8400 } } }, include: { lines: true } });
      await prisma.$transaction(tx => postBillToLedger(tx, f.org.orgId, bill));
      // Remaining 6600 + new receipt 8400, over 6 + 6 units = 1250.
      expect(await prisma.$transaction(tx => getWeightedAverageCost(tx, f.org.orgId, f.itemId, null))).toBe(1250);
      await sell(f, 12, 'AFTER-RECEIPT');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(19400);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('rounded fractional costs leave the last unit with the exact remaining cents', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    try {
      const item = await createItem(org.orgId, 999);
      const costs: number[] = [];
      await prisma.$transaction(async tx => {
        await lockInventoryItems(tx, org.orgId, [item]);
        await addCostLayer(tx, org.orgId, item, null, 3, 1 / 3, 'PURCHASE', 'ROUNDING', DATE);
        for (let i = 0; i < 3; i++) costs.push(await relieveCostLayers(tx, org.orgId, item, null, 1, 'SALES', `ROUND-${i}`, DATE));
      });
      expect(costs).toEqual([0.33, 0.34, 0.33]);
      expect(await inventoryLedgerValue(org.orgId)).toBe(0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('warehouse pools remain separate and unscoped fulfillment records its actual source warehouse', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    try {
      const item = await createItem(org.orgId, 999);
      const a = await prisma.warehouse.create({ data: { organizationId: org.orgId, code: 'A', name: 'A' } });
      const b = await prisma.warehouse.create({ data: { organizationId: org.orgId, code: 'B', name: 'B' } });
      await prisma.$transaction(async tx => {
        await lockInventoryItems(tx, org.orgId, [item]);
        await addCostLayer(tx, org.orgId, item, a.id, 5, 1000, 'PURCHASE', 'WARE-A', DATE);
        await addCostLayer(tx, org.orgId, item, b.id, 5, 1200, 'PURCHASE', 'WARE-B', DATE);
        expect(await getWeightedAverageCost(tx, org.orgId, item, a.id)).toBe(1000);
        expect(await getWeightedAverageCost(tx, org.orgId, item, b.id)).toBe(1200);
        // NULL is the unassigned-stock pool; no stock there uses the empty-pool fallback.
        expect(await getWeightedAverageCost(tx, org.orgId, item, null)).toBe(999);
        expect(await relieveCostLayers(tx, org.orgId, item, null, 4, 'SALES', 'UNSCOPED', DATE)).toBe(4000);
      });
      expect(await prisma.$transaction(tx => getWeightedAverageCost(tx, org.orgId, item, a.id))).toBe(1000);
      expect(await prisma.$transaction(tx => getWeightedAverageCost(tx, org.orgId, item, b.id))).toBe(1200);
      const outbound = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: org.orgId, documentType: 'SALES' } });
      expect(outbound.warehouseId).toBe(a.id); expect(Number(outbound.valueChange)).toBe(-4000);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('a legacy zero-quantity value residual refuses without altering stock or GL', async () => {
    const f = await stock();
    try {
      await sell(f, 10, 'EXHAUST');
      await prisma.inventoryLedgerEntry.create({ data: { organizationId: f.org.orgId, itemId: f.itemId,
        documentType: 'ADJUSTMENT', documentId: 'LEGACY-RESIDUAL', date: DATE, valueChange: -466.67 } });
      await expect(sell(f, 1, 'REFUSED')).rejects.toThrow();
      await expect(prisma.$transaction(tx => getWeightedAverageCost(tx, f.org.orgId, f.itemId, null))).rejects.toThrow('value but no quantity');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(-466.67);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, documentType: 'SALES' } })).toBe(1);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('negative book value with positive stock refuses before an outbound movement', async () => {
    const f = await stock();
    try {
      await prisma.inventoryLedgerEntry.create({ data: { organizationId: f.org.orgId, itemId: f.itemId,
        documentType: 'ADJUSTMENT', documentId: 'LEGACY-VALUE', date: DATE, valueChange: -12000 } });
      await expect(sell(f, 1, 'REFUSED')).rejects.toThrow('does not reconcile');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(-1000);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(11000);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, documentType: 'SALES' } })).toBe(0);
      const lots = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId } });
      expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(10);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('physical stock without a recorded book-value pool refuses instead of using the item default', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    try {
      const item = await createItem(org.orgId, 999);
      await prisma.inventoryLot.create({ data: { organizationId: org.orgId, itemId: item,
        documentType: 'PURCHASE', documentId: 'UNRECORDED', date: DATE, qtyIn: 3, qtyBalance: 3, unitCost: 1000 } });
      await expect(prisma.$transaction(async tx => {
        await lockInventoryItems(tx, org.orgId, [item]);
        await relieveCostLayers(tx, org.orgId, item, null, 1, 'SALES', 'REFUSED', DATE);
      })).rejects.toThrow('does not reconcile');
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
      expect(Number((await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId } })).qtyBalance)).toBe(3);
    } finally { await cleanupOrg(org.orgId); }
  });
});
