/**
 * Invoice void round-trip, against a real Postgres DB. A SENT invoice recognises
 * AR revenue and relieves COGS/inventory; voiding it reverses BOTH journals and
 * un-consumes the stock, returning the trial balance, the AR/COGS accounts, and
 * inventory to their pre-sale state.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer, calculateAndPostCOGS } from '../../inventory-costing';
import { postJournalEntry } from '../../journal-posting';
import { voidInvoice } from '../../invoice-void';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createItem,
  assertTrialBalanced,
  accountBalance,
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

describe('invoice void round-trip', () => {
  it('reverses AR + COGS journals, restores stock, and returns the ledger to zero', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const itemId = await createItem(org.orgId);

    // Receive 10 @ 100 into inventory.
    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, null, 10, 100, InventoryDocumentType.PURCHASE, 'po-1', DATE),
    );
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);

    // A SENT invoice selling 4 units for 1000 (no tax).
    const inv = await prisma.salesInvoice.create({
      data: {
        organizationId: org.orgId,
        number: 'INV-VOID-1',
        customerId,
        issueDate: DATE,
        status: 'SENT',
        subtotal: 1000,
        totalAmount: 1000,
        taxAmount: 0,
      },
      select: { id: true, number: true },
    });

    // Post AR recognition (DR AR / CR Sales) — matching the invoice route's memo.
    await prisma.$transaction((tx) =>
      postJournalEntry(tx, {
        organizationId: org.orgId,
        date: DATE,
        memo: `Sales recognition: ${inv.number}`,
        lines: [
          { accountId: org.accounts.arControl, description: 'AR', debit: 1000, credit: 0 },
          { accountId: org.accounts.salesRevenue, description: 'Sales', debit: 0, credit: 1000 },
        ],
      }),
    );

    // Consume 4 units (tagged SALES) and post the COGS journal (DR COGS / CR Inventory).
    const cogs = await prisma.$transaction((tx) =>
      calculateAndPostCOGS(tx, org.orgId, itemId, null, 4, InventoryDocumentType.SALES, inv.id, DATE),
    );
    expect(cogs).toBeCloseTo(400, 2);
    await prisma.$transaction((tx) =>
      postJournalEntry(tx, {
        organizationId: org.orgId,
        date: DATE,
        memo: `COGS auto-post: ${inv.number}`,
        lines: [
          { accountId: org.accounts.cogsExpense, description: 'COGS', debit: 400, credit: 0 },
          { accountId: org.accounts.inventoryAsset, description: 'Inventory', debit: 0, credit: 400 },
        ],
      }),
    );

    await assertTrialBalanced(org.orgId, 'invoice posted');
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(1000, 2);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(400, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(600, 2);
    await assertInventoryReconciled(org.orgId, 'after sale');

    // Void the invoice.
    await prisma.$transaction((tx) => voidInvoice(tx, org.orgId, inv.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'invoice voided');
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(0, 2);
    expect(await accountBalance(org.orgId, org.accounts.salesRevenue)).toBeCloseTo(0, 2);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(0, 2);
    await assertInventoryReconciled(org.orgId, 'after void');
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(1000, 2);
    expect(await journalEntryCount(org.orgId)).toBe(4); // AR + COGS + 2 reversals

    const voided = await prisma.salesInvoice.findUnique({ where: { id: inv.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});
