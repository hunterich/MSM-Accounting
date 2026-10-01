import { afterAll, describe, expect, it } from 'vitest';
import { addCostLayer } from '../../inventory-costing';
import { postInvoiceSend } from '../../invoice-send-posting';
import { postSalesReturnOnApproval } from '../../sales-return-posting';
import { prepareSalesReturnLines } from '../../sales-return-lines';
import { voidSalesReturn } from '../../return-void';
import { prisma, createTestOrg, createCustomer, createItem, cleanupOrg, disconnect, assertTrialBalanced } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-09-01T00:00:00Z');

async function fixture(method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'FIFO', costs = [100, 100], quantities = [2, 2]) {
  const org = await createTestOrg({ costingMethod: method });
  const customerId = await createCustomer(org.orgId);
  const itemId = await createItem(org.orgId);
  await prisma.$transaction(async (tx) => {
    for (const [idx, cost] of costs.entries()) {
      await addCostLayer(tx, org.orgId, itemId, null, quantities[idx], cost, 'PURCHASE', `receipt-${idx}`, new Date(DATE.getTime() + idx));
    }
  });
  const invoice = await prisma.salesInvoice.create({ data: {
    organizationId: org.orgId, customerId, number: 'INV-RETURN-COST', issueDate: DATE, status: 'SENT',
    lines: { create: { lineNo: 1, itemId, description: 'Product', quantity: quantities[0], price: 500 } },
  }, include: { lines: true } });
  await prisma.$transaction((tx) => postInvoiceSend(tx, org.orgId, invoice.id));
  const sourceId = invoice.lines[0].id;
  const createReturn = (number: string, qty: number, received = true) => prisma.salesReturn.create({ data: {
    organizationId: org.orgId, customerId, invoiceId: invoice.id, number, returnDate: DATE, status: 'APPROVED',
    lines: { create: { lineNo: 1, sourceInvoiceLineId: sourceId, itemId, itemName: 'Product', qtySold: quantities[0], qtyReturn: qty, goodsReceived: received } },
  }, include: { lines: true } });
  return { ...org, itemId, invoice, sourceId, createReturn, customerId };
}

describe('sales return at original sale cost', () => {
  for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) {
    it(`${method}: retains original COGS after purchase costs change and voids cleanly`, async () => {
      const f = await fixture(method, [100, 300]);
      try {
        const source = await prisma.salesInvoiceLine.findUniqueOrThrow({ where: { id: f.sourceId } });
        expect(Number(source.cogsAmount)).toBe(method === 'FIFO' ? 200 : 400);
        await prisma.$transaction((tx) => addCostLayer(tx, f.orgId, f.itemId, null, 10, 900, 'PURCHASE', 'later-purchase', DATE));
        const ret = await f.createReturn('SR-COST', 1);
        await prisma.$transaction((tx) => postSalesReturnOnApproval(tx, ret.id));
        const posted = await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.id }, include: { lines: true } });
        expect(Number(posted.lines[0].inventoryCost)).toBe(method === 'FIFO' ? 100 : 200);
        expect(posted.journalEntryId).toBeTruthy();
        const lots = await prisma.inventoryLot.findMany({ where: { documentId: ret.id, organizationId: f.orgId } });
        expect(Number(lots[0].unitCost)).toBe(method === 'FIFO' ? 100 : 200);
        await assertTrialBalanced(f.orgId);
        await prisma.$transaction((tx) => voidSalesReturn(tx, f.orgId, ret.id, { date: DATE }));
        expect(await prisma.inventoryLot.count({ where: { documentId: ret.id, organizationId: f.orgId } })).toBe(0);
        await assertTrialBalanced(f.orgId);
      } finally { await cleanupOrg(f.orgId); }
    });
  }

  it('mixed received/not-received lines restock only received goods; zero-value returns post once', async () => {
    const f = await fixture();
    try {
      const kept = await f.createReturn('SR-KEPT', 1, false);
      await prisma.$transaction((tx) => postSalesReturnOnApproval(tx, kept.id));
      await prisma.$transaction((tx) => postSalesReturnOnApproval(tx, kept.id));
      const row = await prisma.salesReturn.findUniqueOrThrow({ where: { id: kept.id }, include: { lines: true } });
      expect(row.postedAt).toBeTruthy();
      expect(row.journalEntryId).toBeNull();
      expect(Number(row.lines[0].inventoryCost)).toBe(0);
      expect(await prisma.inventoryLedgerEntry.count({ where: { documentId: kept.id } })).toBe(0);
      const received = await f.createReturn('SR-RECEIVED', 1);
      await prisma.$transaction((tx) => postSalesReturnOnApproval(tx, received.id));
      await expect(prisma.$transaction((tx) => prepareSalesReturnLines(tx, f.orgId, f.invoice.id, f.customerId,
        [{ sourceInvoiceLineId: f.sourceId, itemId: f.itemId, qtyReturn: 1 }]))).rejects.toThrow(/remaining/);
      await prisma.$transaction((tx) => voidSalesReturn(tx, f.orgId, kept.id, { date: DATE }));
    } finally { await cleanupOrg(f.orgId); }
  });

  it('rounds partial returns cumulatively and preserves zero-cost stock quantities', async () => {
    const f = await fixture('FIFO', [1 / 3, 10], [3, 3]);
    try {
      const costs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const ret = await f.createReturn(`SR-PART-${i}`, 1);
        await prisma.$transaction((tx) => postSalesReturnOnApproval(tx, ret.id));
        const line = await prisma.salesReturnLine.findFirstOrThrow({ where: { salesReturnId: ret.id } });
        costs.push(Number(line.inventoryCost));
      }
      expect(costs).toEqual([0.33, 0.34, 0.33]);
      await assertTrialBalanced(f.orgId);
    } finally { await cleanupOrg(f.orgId); }
    const zero = await fixture('FIFO', [0, 10]);
    try {
      const ret = await zero.createReturn('SR-ZERO', 1);
      await prisma.$transaction((tx) => postSalesReturnOnApproval(tx, ret.id));
      const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { documentId: ret.id } });
      expect(Number(lot.qtyIn)).toBe(1);
      expect(Number(lot.unitCost)).toBe(0);
    } finally { await cleanupOrg(zero.orgId); }
  });

  it('two simultaneous approvals post a return exactly once', async () => {
    const f = await fixture();
    try {
      const ret = await f.createReturn('SR-CONCURRENT', 1);
      await Promise.all([
        prisma.$transaction((tx) => postSalesReturnOnApproval(tx, ret.id)),
        prisma.$transaction((tx) => postSalesReturnOnApproval(tx, ret.id)),
      ]);
      expect(await prisma.inventoryLedgerEntry.count({ where: { documentId: ret.id, documentType: 'SALES_RETURN' } })).toBe(1);
    } finally { await cleanupOrg(f.orgId); }
  });
});
