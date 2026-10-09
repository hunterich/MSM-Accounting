import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { reverseInvoicePosting } from '@/lib/repost';
import { voidInvoice } from '@/lib/invoice-void';
import { prisma, createTestOrg, createCustomer, createVendor, createItem, cleanupOrg, disconnect,
  accountBalance, assertInventoryReconciled, assertTrialBalanced, type TestOrg } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-07-10');

async function setup(method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'FIFO', costs = [100, 200]) {
  const org = await createTestOrg();
  await prisma.organization.update({ where: { id: org.orgId }, data: { costingMethod: method } });
  const customerId = await createCustomer(org.orgId);
  const vendorId = await createVendor(org.orgId);
  const itemId = await createItem(org.orgId);
  for (const [index, qty, price] of [[1, 2, costs[0]], [2, 5, costs[1]]]) {
    const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: `B-${index}`, issueDate: new Date(DATE.getTime() + index * 1000), status: 'OPEN', subtotal: qty * price, totalAmount: qty * price } });
    await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, { id: bill.id, number: bill.number, issueDate: bill.issueDate,
      apAccountId: null, taxable: false, taxInclusive: false, taxRate: 0,
      lines: [{ id: `b-${index}`, itemId, quantity: qty, price, lineTotal: qty * price, purchaseOrderLineId: null }] }));
  }
  const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-CORRECT', issueDate: DATE,
    status: 'SENT', subtotal: 900, totalAmount: 900, taxEnabled: false, taxRate: 0,
    lines: { create: { itemId, description: 'Correction item', lineNo: 1, quantity: 3, price: 300, lineSubtotal: 900 } } } });
  const originalLots = await lots(org.orgId);
  await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
  return { org, invoice, itemId, originalLots };
}

const lots = (orgId: string) => prisma.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
async function edit(org: TestOrg, invoiceId: string, itemId: string, quantity: number) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${invoiceId} AND "organizationId" = ${org.orgId} FOR UPDATE`;
    const current = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await reverseInvoicePosting(tx, org.orgId, current, { date: DATE });
    await tx.salesInvoice.update({ where: { id: invoiceId }, data: { totalAmount: quantity * 300, subtotal: quantity * 300 } });
    await tx.salesInvoiceLine.updateMany({ where: { invoiceId }, data: { itemId, quantity, price: 300, lineSubtotal: quantity * 300 } });
    await postInvoiceSend(tx, org.orgId, invoiceId);
  });
}

describe('posted inventory invoice corrections', () => {
  it('changing the stocked item restores the old item and consumes the replacement; void restores both', async () => {
    const { org, invoice, originalLots } = await setup();
    try {
      const replacement = await createItem(org.orgId);
      const vendorId = await createVendor(org.orgId);
      const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'B-REPLACE', issueDate: DATE, status: 'OPEN', subtotal: 1500, totalAmount: 1500 } });
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, { id: bill.id, number: bill.number, issueDate: DATE,
        apAccountId: null, taxable: false, taxInclusive: false, taxRate: 0,
        lines: [{ id: 'replacement', itemId: replacement, quantity: 5, price: 300, lineTotal: 1500, purchaseOrderLineId: null }] }));
      const replacementLot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, itemId: replacement } });
      await edit(org, invoice.id, replacement, 2);
      expect((await lots(org.orgId)).filter(lot => lot.itemId !== replacement)).toEqual(originalLots);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(600);
      await assertInventoryReconciled(org.orgId, 'after item replacement');
      await prisma.$transaction(tx => voidInvoice(tx, org.orgId, invoice.id, { date: DATE }));
      expect(await prisma.inventoryLot.findUniqueOrThrow({ where: { id: replacementLot.id } })).toEqual(replacementLot);
      await assertInventoryReconciled(org.orgId, 'after replacement void');
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('repeated FIFO corrections span original lots; final void restores each original lot and only reverses the current journals', async () => {
    const { org, invoice, itemId, originalLots } = await setup();
    try {
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(400);
      await edit(org, invoice.id, itemId, 1);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(100);
      await assertInventoryReconciled(org.orgId, 'after decrease');
      await edit(org, invoice.id, itemId, 4);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(600);
      expect(await accountBalance(org.orgId, org.accounts.arControl)).toBe(1200);
      await assertInventoryReconciled(org.orgId, 'after increase');
      const beforeVoid = await prisma.journalEntry.count({ where: { organizationId: org.orgId } });
      await prisma.$transaction(tx => voidInvoice(tx, org.orgId, invoice.id, { date: DATE }));
      expect(await lots(org.orgId)).toEqual(originalLots); // Includes lot identity, date, qtyOut, unit cost and FIFO order.
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0);
      expect(await accountBalance(org.orgId, org.accounts.arControl)).toBe(0);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(beforeVoid + 2);
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId, documentType: InventoryDocumentType.SALES, reversedAt: null } })).toBe(0);
      await assertInventoryReconciled(org.orgId, 'after final void');
      await assertTrialBalanced(org.orgId, 'after final void');
      await expect(prisma.$transaction(tx => voidInvoice(tx, org.orgId, invoice.id, { date: DATE }))).rejects.toThrow(/already voided/);
      expect(await lots(org.orgId)).toEqual(originalLots);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('an overselling correction rolls back document, lots, draws, journals and reversal markers', async () => {
    const { org, invoice, itemId } = await setup();
    try {
      const before = { invoice: await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } }),
        lots: await lots(org.orgId), ledger: await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId } }),
        journals: await prisma.journalEntry.count({ where: { organizationId: org.orgId } }) };
      await expect(edit(org, invoice.id, itemId, 8)).rejects.toThrow(/Insufficient stock/);
      expect(await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } })).toEqual(before.invoice);
      expect(await lots(org.orgId)).toEqual(before.lots);
      expect(await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId } })).toEqual(before.ledger);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(before.journals);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('weighted-average fractional corrections restore original lot quantities and reverse recorded COGS exactly', async () => {
    const { org, invoice, itemId, originalLots } = await setup('WEIGHTED_AVERAGE', [100, 100]);
    try {
      await edit(org, invoice.id, itemId, 1.25);
      const line = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(Number(line.cogsAmount)).toBeCloseTo(125, 2);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(125, 2);
      await assertInventoryReconciled(org.orgId, 'after WA correction');
      await prisma.$transaction(tx => voidInvoice(tx, org.orgId, invoice.id, { date: DATE }));
      expect(await lots(org.orgId)).toEqual(originalLots);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0);
      await assertInventoryReconciled(org.orgId, 'after WA void');
      await assertTrialBalanced(org.orgId, 'after WA void');
    } finally { await cleanupOrg(org.orgId); }
  });

  it('blocks exact correction when weighted-average COGS differs from the source-lot value', async () => {
    const { org, invoice, itemId } = await setup('WEIGHTED_AVERAGE');
    try {
      const before = await lots(org.orgId);
      const journals = await prisma.journalEntry.count({ where: { organizationId: org.orgId } });
      await expect(edit(org, invoice.id, itemId, 1)).rejects.toThrow(/cannot be restored exactly/);
      expect(await lots(org.orgId)).toEqual(before);
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(journals);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('refuses editing untracked legacy movements rather than reconstructing guessed lot draws', async () => {
    const { org, invoice, itemId } = await setup();
    try {
      await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: org.orgId, documentType: 'SALES' }, data: { drawsTracked: false } });
      const before = await lots(org.orgId);
      await expect(edit(org, invoice.id, itemId, 1)).rejects.toThrow(/original stock-lot tracking/);
      expect(await lots(org.orgId)).toEqual(before);
    } finally { await cleanupOrg(org.orgId); }
  });
});
