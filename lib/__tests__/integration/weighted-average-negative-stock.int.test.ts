import { afterAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { voidBill } from '@/lib/bill-void';
import { voidInvoice } from '@/lib/invoice-void';
import { reverseInvoicePosting } from '@/lib/repost';
import { addCostLayer, lockInventoryItems } from '@/lib/inventory-costing';
import { previewInventoryCarryingValues } from '@/lib/inventory-carrying-preview';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect, inventoryLedgerValue, inventoryLotValue, accountBalance, assertTrialBalanced } from './harness';

afterAll(disconnect);
describe('INV-02 opt-in negative-stock compatibility', () => {
  it('keeps an explicitly allowed WA shortfall postable at the recorded estimated cost', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE', allowNegativeStock: true });
    try {
      const itemId = await createItem(org.orgId, 100), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
      const date = new Date('2026-09-10');
      const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'RECEIPT', issueDate: date,
        status: 'OPEN', totalAmount: 500, lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 5, price: 100, lineTotal: 500 } } }, include: { lines: true } });
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'NEGATIVE-SALE', issueDate: date,
        status: 'DRAFT', totalAmount: 2100, subtotal: 2100,
        lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 7, price: 300, lineSubtotal: 2100 } } } });
      await prisma.$transaction(async tx => {
        await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });
        await postInvoiceSend(tx, org.orgId, invoice.id, { allowNegativeStock: true });
      });
      expect(await inventoryLedgerValue(org.orgId)).toBe(-200);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(-200);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(700);
    } finally { await cleanupOrg(org.orgId); }
  });
});

const SALE_DATE = new Date('2026-09-10'), RECEIPT_DATE = new Date('2026-10-02'), VOID_DATE = new Date('2026-10-20');

async function fixture() {
  const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE', allowNegativeStock: true });
  const itemId = await createItem(org.orgId, 100), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
  let sequence = 0;
  const draftBill = (quantity: number, price: number, date = RECEIPT_DATE) => {
    const number = `BILL-${++sequence}`;
    return prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, vendorInvoiceNo: number, issueDate: date, status: 'OPEN',
      totalAmount: quantity * price, lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity, price, lineTotal: quantity * price } } }, include: { lines: true } });
  };
  const postBill = (bill: Awaited<ReturnType<typeof draftBill>>) => prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  const buy = async (quantity: number, price: number, date = RECEIPT_DATE) => { const bill = await draftBill(quantity, price, date); await postBill(bill); return bill; };
  const draftSale = (quantity: number, date = SALE_DATE) => {
    const number = `SALE-${++sequence}`;
    return prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: date, status: 'SENT',
      subtotal: quantity * 300, totalAmount: quantity * 300, lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity, price: 300, lineSubtotal: quantity * 300 } } } });
  };
  const postSale = (invoice: { id: string }) => prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id, { allowNegativeStock: true }));
  const sell = async (quantity: number, date = SALE_DATE) => { const invoice = await draftSale(quantity, date); await postSale(invoice); return invoice; };
  const books = async () => {
    const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, select: { qtyBalance: true } });
    return {
      inventoryGl: await accountBalance(org.orgId, org.accounts.inventoryAsset),
      cogs: await accountBalance(org.orgId, org.accounts.cogsExpense),
      ledger: await inventoryLedgerValue(org.orgId),
      onHand: lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0),
      lotValue: await inventoryLotValue(org.orgId),
    };
  };
  const preview = (warehouseId: string | null = null) => prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return previewInventoryCarryingValues(tx, org.orgId, itemId, warehouseId);
  }, { isolationLevel: 'RepeatableRead' });
  const settlements = () => prisma.inventoryShortfallSettlement.findMany({ where: { organizationId: org.orgId }, orderBy: { settlementSequence: 'asc' } });
  return { org, itemId, draftBill, postBill, buy, draftSale, postSale, sell, books, preview, settlements };
}

async function snapshot(tx: Prisma.TransactionClient | typeof prisma, organizationId: string) {
  const where = { organizationId }, orderBy = { id: 'asc' as const };
  return { lots: await tx.inventoryLot.findMany({ where, orderBy }),
    ledger: await tx.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await tx.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    settlements: await tx.inventoryShortfallSettlement.findMany({ where, orderBy }),
    invoices: await tx.salesInvoice.findMany({ where, orderBy }), bills: await tx.bill.findMany({ where, orderBy }) };
}

describe('INV-02 approved WA negative stock: receipt-date COGS settlement', () => {
  it('receives into an already-negative pool and posts the approved 40 difference on the receipt date', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE);
      const sale = await f.sell(7);
      expect(await f.books()).toMatchObject({ inventoryGl: -200, cogs: 700, ledger: -200, onHand: 0 });
      expect(await f.preview()).toMatchObject({ ledgerQuantity: '-2.0000', bookValue: '-200.00', outstandingShortfallQuantity: '2.0000', outstandingShortfallEstimate: '200.00' });

      const receipt = await f.buy(2, 120);
      expect(await f.books()).toEqual({ inventoryGl: 0, cogs: 740, ledger: 0, onHand: 0, lotValue: 0 });
      await assertTrialBalanced(f.org.orgId, 'after settlement');

      // The original sale estimate is untouched.
      const saleMovement = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: sale.id },
        include: { lotDraws: { orderBy: { quantity: 'asc' } } } });
      expect(saleMovement).toMatchObject({ qtyOut: expect.anything(), reversedAt: null });
      expect(Number(saleMovement.valueChange)).toBe(-700);
      expect(saleMovement.lotDraws.map(draw => [Number(draw.quantity), Number(draw.costValue), draw.shortfall])).toEqual([[2, 200, true], [5, 500, false]]);
      expect(Number((await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: sale.id } })).cogsAmount)).toBe(700);

      const [row] = await f.settlements();
      const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: receipt.id } });
      expect(row).toMatchObject({ saleDrawId: saleMovement.lotDraws[0].id, saleLedgerEntryId: saleMovement.id, receiptLotId: lot.id,
        receiptLedgerEntryId: lot.inboundLedgerEntryId, date: RECEIPT_DATE, reversedAt: null });
      expect([row.quantity, row.estimatedValue, row.actualValue, row.cogsAdjustment].map(Number)).toEqual([2, 200, 240, 40]);
      expect([Number(lot.qtyIn), Number(lot.qtyOut), Number(lot.qtyBalance)]).toEqual([2, 2, 0]);
      // Same value in the stock ledger as in Inventory GL, without a quantity movement.
      const movement = await prisma.inventoryLedgerEntry.findUniqueOrThrow({ where: { id: row.adjustmentLedgerEntryId! } });
      expect(movement).toMatchObject({ documentType: 'SHORTFALL_SETTLEMENT', documentId: receipt.id, date: RECEIPT_DATE });
      expect([Number(movement.qtyIn), Number(movement.qtyOut), Number(movement.valueChange)]).toEqual([0, 0, -40]);
      const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: row.journalEntryId! }, include: { lines: true } });
      expect(journal.date).toEqual(RECEIPT_DATE);
      expect(journal.lines.map(line => [line.accountId, Number(line.debit), Number(line.credit)]).sort()).toEqual([
        [f.org.accounts.cogsExpense, 40, 0], [f.org.accounts.inventoryAsset, 0, 40]].sort());
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('keeps only excess received quantity on hand, valued at the receipt cost', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE); await f.sell(7); await f.buy(3, 120);
      expect(await f.books()).toEqual({ inventoryGl: 120, cogs: 740, ledger: 120, onHand: 1, lotValue: 120 });
      expect(await f.preview()).toMatchObject({ ledgerQuantity: '1.0000', bookValue: '120.00', outstandingShortfallQuantity: '0.0000' });
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('credits COGS when the goods arrive cheaper than estimated', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE); await f.sell(7); await f.buy(2, 80);
      expect(await f.books()).toEqual({ inventoryGl: 0, cogs: 660, ledger: 0, onHand: 0, lotValue: 0 });
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('settles successive partial receipts against one unchanged estimate', async () => {
    const f = await fixture();
    try {
      await f.sell(3); // nothing on hand: estimated at the item cost price
      expect(await f.books()).toMatchObject({ inventoryGl: -300, cogs: 300 });
      await f.buy(1, 120);
      expect(await f.books()).toMatchObject({ inventoryGl: -200, cogs: 320, ledger: -200, onHand: 0 });
      expect(await f.preview()).toMatchObject({ outstandingShortfallQuantity: '2.0000', outstandingShortfallEstimate: '200.00' });
      await f.buy(2, 130);
      expect(await f.books()).toEqual({ inventoryGl: 0, cogs: 380, ledger: 0, onHand: 0, lotValue: 0 });
      expect((await f.settlements()).map(row => [Number(row.quantity), Number(row.estimatedValue), Number(row.cogsAdjustment)])).toEqual([[1, 100, 20], [2, 200, 60]]);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('settles only the warehouse that ran short', async () => {
    const f = await fixture();
    try {
      const sale = await f.draftSale(2);
      await prisma.$transaction(tx => postInvoiceSend(tx, f.org.orgId, sale.id, { allowNegativeStock: true, warehouseId: f.org.warehouseId }));
      await f.buy(2, 120); // bills receive into unassigned stock
      expect(await f.settlements()).toEqual([]);
      expect(await f.preview(null)).toMatchObject({ ledgerQuantity: '2.0000', bookValue: '240.00' });
      expect(await f.preview(f.org.warehouseId)).toMatchObject({ ledgerQuantity: '-2.0000', outstandingShortfallEstimate: '200.00' });
      await prisma.$transaction(async tx => {
        await lockInventoryItems(tx, f.org.orgId, [f.itemId]);
        await addCostLayer(tx, f.org.orgId, f.itemId, f.org.warehouseId, 2, 130, 'ADJUSTMENT', 'warehouse-receipt', RECEIPT_DATE, 260);
      });
      const [row] = await f.settlements();
      expect(row.warehouseId).toBe(f.org.warehouseId);
      expect(Number(row.cogsAdjustment)).toBe(60);
      expect(await f.preview(null)).toMatchObject({ ledgerQuantity: '2.0000', bookValue: '240.00' });
      expect(await f.preview(f.org.warehouseId)).toMatchObject({ ledgerQuantity: '0.0000', bookValue: '0.00' });
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('refuses a receipt dated in a closed period and leaves every record unchanged', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE); await f.sell(7);
      await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: 'October 2026', status: 'CLOSED',
        startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31T23:59:59.999Z') } });
      const bill = await f.draftBill(2, 120);
      const before = await snapshot(prisma, f.org.orgId);
      await expect(f.postBill(bill)).rejects.toThrow('closed/locked');
      expect(await snapshot(prisma, f.org.orgId)).toEqual(before);
    } finally { await cleanupOrg(f.org.orgId); }
  });
});

describe('INV-02 approved WA negative stock: reversals', () => {
  it('receipt void unwinds the settlement atomically and restores the original estimate', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE); await f.sell(7);
      const receipt = await f.buy(2, 120);
      await prisma.$transaction(tx => voidBill(tx, f.org.orgId, receipt.id, { date: VOID_DATE }));
      expect(await f.books()).toEqual({ inventoryGl: -200, cogs: 700, ledger: -200, onHand: 0, lotValue: 0 });
      expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-500);
      const [row] = await f.settlements();
      expect(row.reversedAt).toEqual(VOID_DATE);
      const reversal = await prisma.inventoryLedgerEntry.findUniqueOrThrow({ where: { id: row.reversalLedgerEntryId! } });
      expect(reversal).toMatchObject({ reversesLedgerEntryId: row.adjustmentLedgerEntryId, date: VOID_DATE });
      expect(Number(reversal.valueChange)).toBe(40);
      expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: row.reversalJournalEntryId! } })).date).toEqual(VOID_DATE);
      expect(await f.preview()).toMatchObject({ outstandingShortfallQuantity: '2.0000', outstandingShortfallEstimate: '200.00' });
      await f.buy(2, 110);
      expect(await f.books()).toMatchObject({ inventoryGl: 0, cogs: 720, ledger: 0, onHand: 0 });
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('sale void after settlement puts the received stock back at its actual cost', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE);
      const sale = await f.sell(7);
      await f.buy(2, 120);
      await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, sale.id, { date: VOID_DATE }));
      expect(await f.books()).toEqual({ inventoryGl: 740, cogs: 0, ledger: 740, onHand: 7, lotValue: 740 });
      expect((await f.settlements()).every(row => row.reversedAt?.getTime() === VOID_DATE.getTime())).toBe(true);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('sale void refuses while a later sale still depends on the shortage, then succeeds newest-first', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE);
      const first = await f.sell(7), second = await f.sell(1);
      const before = await snapshot(prisma, f.org.orgId);
      await expect(prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, first.id, { date: VOID_DATE }))).rejects.toThrow('Void that sale');
      expect(await snapshot(prisma, f.org.orgId)).toEqual(before);
      await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, second.id, { date: VOID_DATE }));
      await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, first.id, { date: VOID_DATE }));
      expect(await f.books()).toEqual({ inventoryGl: 500, cogs: 0, ledger: 500, onHand: 5, lotValue: 500 });
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('refuses to void an earlier receipt whose shortage a later receipt completed', async () => {
    const f = await fixture();
    try {
      await f.sell(3);
      const earlier = await f.buy(1, 120), later = await f.buy(2, 120);
      const before = await snapshot(prisma, f.org.orgId);
      await expect(prisma.$transaction(tx => voidBill(tx, f.org.orgId, earlier.id, { date: VOID_DATE }))).rejects.toThrow('Reverse that receipt first');
      expect(await snapshot(prisma, f.org.orgId)).toEqual(before);
      await prisma.$transaction(tx => voidBill(tx, f.org.orgId, later.id, { date: VOID_DATE }));
      await prisma.$transaction(tx => voidBill(tx, f.org.orgId, earlier.id, { date: VOID_DATE }));
      expect(await f.books()).toEqual({ inventoryGl: -300, cogs: 300, ledger: -300, onHand: 0, lotValue: 0 });
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('editing a shortage invoice is refused in favour of void and replace', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE);
      const sale = await f.sell(7);
      const posted = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: sale.id } });
      await expect(prisma.$transaction(tx => reverseInvoicePosting(tx, f.org.orgId, posted, { date: VOID_DATE }))).rejects.toThrow('void and replace');
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('legacy negative stock without estimate tracking is refused for review, not reconstructed', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE); await f.sell(7);
      // A pre-policy shortage: no explicit shortfall marker on the missing quantity.
      await prisma.inventoryLotDraw.updateMany({ where: { ledgerEntry: { organizationId: f.org.orgId } }, data: { shortfall: false } });
      await expect(f.preview()).rejects.toThrow('requires review');
      const bill = await f.draftBill(2, 120);
      const before = await snapshot(prisma, f.org.orgId);
      await expect(f.postBill(bill)).rejects.toThrow(/requires (review|reconciliation)/);
      expect(await snapshot(prisma, f.org.orgId)).toEqual(before);
    } finally { await cleanupOrg(f.org.orgId); }
  });
});

describe('INV-02 approved WA negative stock: overlapping writers', () => {
  it('a concurrent sale and receipt end with the same books in either order', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE);
      const sale = await f.draftSale(7), bill = await f.draftBill(2, 120);
      await Promise.all([f.postSale(sale), f.postBill(bill)]);
      // Receipt first: average 740 / 7. Sale first: estimate 700 + settlement 40.
      expect(await f.books()).toEqual({ inventoryGl: 0, cogs: 740, ledger: 0, onHand: 0, lotValue: 0 });
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });

  it('concurrent receipt void and sale void each unwind the settlement exactly once', async () => {
    const f = await fixture();
    try {
      await f.buy(5, 100, SALE_DATE);
      const sale = await f.sell(7), receipt = await f.buy(2, 120);
      await Promise.all([
        prisma.$transaction(tx => voidBill(tx, f.org.orgId, receipt.id, { date: VOID_DATE })),
        prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, sale.id, { date: VOID_DATE })),
      ]);
      expect(await f.books()).toEqual({ inventoryGl: 500, cogs: 0, ledger: 500, onHand: 5, lotValue: 500 });
      const rows = await f.settlements();
      expect(rows).toHaveLength(1);
      expect(rows[0].reversedAt).toEqual(VOID_DATE);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, reversesLedgerEntryId: rows[0].adjustmentLedgerEntryId } })).toBe(1);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });
});
