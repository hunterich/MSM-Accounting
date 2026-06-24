/**
 * Return void round-trips against a real Postgres DB.
 *   - Sales return: restocks inventory (DR Inventory / CR COGS). Voiding reverses
 *     that JE and removes the restock — blocked if the restocked stock was re-sold.
 *   - Purchase return: removes inventory (DR apReturn / CR Inventory). Voiding
 *     reverses the JE and restores the removed stock.
 * Both keep the trial balance and inventory reconciled.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer, calculateAndPostCOGS, relieveCostLayers } from '../../inventory-costing';
import { postJournalEntry } from '../../journal-posting';
import { voidSalesReturn, voidPurchaseReturn } from '../../return-void';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createVendor,
  createItem,
  assertTrialBalanced,
  inventoryLotValue,
  assertInventoryReconciled,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-20T00:00:00.000Z');

describe('sales return void round-trip', () => {
  it('reverses the restock JE and removes the restocked stock', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const itemId = await createItem(org.orgId);
    const invoice = await prisma.salesInvoice.create({
      data: { organizationId: org.orgId, number: 'INV-SR-1', customerId, issueDate: DATE, status: 'SENT' },
      select: { id: true },
    });

    const sr = await prisma.salesReturn.create({
      data: { organizationId: org.orgId, number: 'SR-1', customerId, invoiceId: invoice.id, returnDate: DATE, status: 'DRAFT' },
      select: { id: true, number: true },
    });

    // Approve: restock 5 @ 200 + post DR Inventory / CR COGS, stamp journalEntryId.
    await prisma.$transaction(async (tx) => {
      await addCostLayer(tx, org.orgId, itemId, null, 5, 200, InventoryDocumentType.SALES_RETURN, sr.id, DATE);
      const entry = await postJournalEntry(tx, {
        organizationId: org.orgId, date: DATE, memo: `Sales return inventory: ${sr.number}`,
        lines: [
          { accountId: org.accounts.inventoryAsset, description: 'Restock', debit: 1000, credit: 0 },
          { accountId: org.accounts.cogsExpense, description: 'COGS reversal', debit: 0, credit: 1000 },
        ],
      });
      await tx.salesReturn.update({ where: { id: sr.id }, data: { status: 'APPROVED', journalEntryId: entry.id } });
    });

    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);
    await assertTrialBalanced(org.orgId, 'sales return approved');

    await prisma.$transaction((tx) => voidSalesReturn(tx, org.orgId, sr.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'sales return voided');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(0, 2);
    await assertInventoryReconciled(org.orgId, 'after void');
    expect(await journalEntryCount(org.orgId)).toBe(2);
    const voided = await prisma.salesReturn.findUnique({ where: { id: sr.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });

  it('refuses to void a sales return whose restock has been re-sold', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const itemId = await createItem(org.orgId);
    const invoice = await prisma.salesInvoice.create({
      data: { organizationId: org.orgId, number: 'INV-SR-2', customerId, issueDate: DATE, status: 'SENT' },
      select: { id: true },
    });
    const sr = await prisma.salesReturn.create({
      data: { organizationId: org.orgId, number: 'SR-2', customerId, invoiceId: invoice.id, returnDate: DATE, status: 'DRAFT' },
      select: { id: true, number: true },
    });

    await prisma.$transaction(async (tx) => {
      await addCostLayer(tx, org.orgId, itemId, null, 5, 200, InventoryDocumentType.SALES_RETURN, sr.id, DATE);
      const entry = await postJournalEntry(tx, {
        organizationId: org.orgId, date: DATE, memo: `Sales return inventory: ${sr.number}`,
        lines: [
          { accountId: org.accounts.inventoryAsset, description: 'Restock', debit: 1000, credit: 0 },
          { accountId: org.accounts.cogsExpense, description: 'COGS reversal', debit: 0, credit: 1000 },
        ],
      });
      await tx.salesReturn.update({ where: { id: sr.id }, data: { status: 'APPROVED', journalEntryId: entry.id } });
    });

    // Re-sell 2 of the 5 restocked units.
    await prisma.$transaction((tx) => relieveCostLayers(tx, org.orgId, itemId, null, 2, InventoryDocumentType.SALES, 'sale-x', DATE));

    await expect(
      prisma.$transaction((tx) => voidSalesReturn(tx, org.orgId, sr.id, { date: DATE })),
    ).rejects.toThrow(/consumed|sold/i);

    await cleanupOrg(org.orgId);
  });
});

describe('purchase return void round-trip', () => {
  it('reverses the removal JE and restores the removed stock', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-PR-1', vendorId, issueDate: DATE, status: 'OPEN' },
      select: { id: true },
    });

    // Receive 10 @ 100.
    await prisma.$transaction((tx) => addCostLayer(tx, org.orgId, itemId, null, 10, 100, InventoryDocumentType.PURCHASE, 'po-1', DATE));
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);

    const pr = await prisma.purchaseReturn.create({
      data: { organizationId: org.orgId, number: 'PR-1', vendorId, billId: bill.id, returnDate: DATE, status: 'DRAFT' },
      select: { id: true, number: true },
    });

    // Approve: remove 4 (PURCHASE_RETURN draw-down) + post DR apReturn / CR Inventory.
    await prisma.$transaction(async (tx) => {
      const cost = await calculateAndPostCOGS(tx, org.orgId, itemId, null, 4, InventoryDocumentType.PURCHASE_RETURN, pr.id, DATE);
      const entry = await postJournalEntry(tx, {
        organizationId: org.orgId, date: DATE, memo: `Purchase return inventory: ${pr.number}`,
        lines: [
          { accountId: org.accounts.apControl, description: 'apReturn clearing', debit: cost, credit: 0 },
          { accountId: org.accounts.inventoryAsset, description: 'Inventory removal', debit: 0, credit: cost },
        ],
      });
      await tx.purchaseReturn.update({ where: { id: pr.id }, data: { status: 'APPROVED', journalEntryId: entry.id } });
    });

    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(600, 2);
    await assertTrialBalanced(org.orgId, 'purchase return approved');

    await prisma.$transaction((tx) => voidPurchaseReturn(tx, org.orgId, pr.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'purchase return voided');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);
    await assertInventoryReconciled(org.orgId, 'after void');
    expect(await journalEntryCount(org.orgId)).toBe(2);
    const voided = await prisma.purchaseReturn.findUnique({ where: { id: pr.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});
