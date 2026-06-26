/**
 * Concurrency invariants for the DOCUMENT void paths — invoices, stock
 * adjustments, credit/debit notes, and sales/purchase returns.
 *
 * Finding 4 — unlike payments/bills (already claim-first), these helpers did
 * `findFirst` (no row lock) → reverse the GL/inventory → plain `update` to mark
 * VOID. Two concurrent voids both pass the status check and both reverse → the
 * journal entry is reversed TWICE → corrupted ledger. The fix claims VOID with a
 * guarded `updateMany` (assert count === 1) BEFORE any side effect, so the loser
 * blocks on the row lock then rejects (409/422) without reversing.
 *
 * Each test fires two concurrent voids and asserts:
 *   - exactly one fulfilled, one rejected (conflict),
 *   - the GL was reversed EXACTLY once (posting count → posting + 1 reversal each).
 *
 * Run with:  npm run test:int -- void-concurrency-documents
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer, calculateAndPostCOGS } from '../../inventory-costing';
import { postJournalEntry } from '../../journal-posting';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { postCreditNoteOnApply } from '../../credit-note-posting';
import { postDebitNoteOnApply } from '../../debit-note-posting';
import { voidInvoice } from '../../invoice-void';
import { voidStockAdjustment } from '../../stock-adjustment-void';
import { voidCreditNote, voidDebitNote } from '../../note-void';
import { voidSalesReturn, voidPurchaseReturn } from '../../return-void';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createVendor,
  createItem,
  assertTrialBalanced,
  assertInventoryReconciled,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-20T00:00:00.000Z');

function tally(results: PromiseSettledResult<unknown>[]) {
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { fulfilled, rejected };
}

/** The loser is blocked either by the row-lock claim (409) or an early terminal-state read (422). */
function expectConflict(reason: unknown) {
  const status = (reason as { status?: number }).status;
  expect([409, 422]).toContain(status);
}

describe('void concurrency: invoice reverses AR + COGS exactly once', () => {
  it('two concurrent invoice voids → one wins, one conflicts, JEs reversed once', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const itemId = await createItem(org.orgId);

    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, null, 10, 100, InventoryDocumentType.PURCHASE, 'po-1', DATE),
    );

    const inv = await prisma.salesInvoice.create({
      data: { organizationId: org.orgId, number: 'INV-VC', customerId, issueDate: DATE, status: 'SENT', subtotal: 1000, totalAmount: 1000, taxAmount: 0 },
      select: { id: true, number: true },
    });
    await prisma.$transaction((tx) =>
      postJournalEntry(tx, {
        organizationId: org.orgId, date: DATE, memo: `Sales recognition: ${inv.number}`,
        lines: [
          { accountId: org.accounts.arControl, description: 'AR', debit: 1000, credit: 0 },
          { accountId: org.accounts.salesRevenue, description: 'Sales', debit: 0, credit: 1000 },
        ],
      }),
    );
    await prisma.$transaction((tx) => calculateAndPostCOGS(tx, org.orgId, itemId, null, 4, InventoryDocumentType.SALES, inv.id, DATE));
    await prisma.$transaction((tx) =>
      postJournalEntry(tx, {
        organizationId: org.orgId, date: DATE, memo: `COGS auto-post: ${inv.number}`,
        lines: [
          { accountId: org.accounts.cogsExpense, description: 'COGS', debit: 400, credit: 0 },
          { accountId: org.accounts.inventoryAsset, description: 'Inventory', debit: 0, credit: 400 },
        ],
      }),
    );
    expect(await journalEntryCount(org.orgId)).toBe(2); // AR recognition + COGS

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidInvoice(tx, org.orgId, inv.id, { date: DATE })),
      prisma.$transaction((tx) => voidInvoice(tx, org.orgId, inv.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    // 2 posts + 2 reversals = 4 (a double-reverse would be 6).
    expect(await journalEntryCount(org.orgId)).toBe(4);
    const after = await prisma.salesInvoice.findUnique({ where: { id: inv.id }, select: { status: true } });
    expect(after?.status).toBe('VOID');
    await assertTrialBalanced(org.orgId, 'invoice void concurrency');
    await assertInventoryReconciled(org.orgId, 'invoice void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: stock adjustment reverses exactly once', () => {
  it('two concurrent adjustment voids → one wins, one conflicts, variance JE reversed once', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);

    const adj = await prisma.stockAdjustment.create({
      data: { organizationId: org.orgId, number: 'ADJ-VC', date: DATE, reason: 'Concurrency' },
      select: { id: true, number: true },
    });
    await prisma.$transaction((tx) =>
      postStockAdjustmentToLedger(tx, org.orgId, {
        id: adj.id, number: adj.number, date: DATE, warehouseId: null,
        lines: [{ itemId, oldQty: 0, newQty: 8, unitCost: 50 }],
      }),
    );
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidStockAdjustment(tx, org.orgId, adj.id, { date: DATE })),
      prisma.$transaction((tx) => voidStockAdjustment(tx, org.orgId, adj.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    expect(await journalEntryCount(org.orgId)).toBe(2); // post + one reversal
    const after = await prisma.stockAdjustment.findUnique({ where: { id: adj.id }, select: { status: true } });
    expect(after?.status).toBe('VOID');
    await assertTrialBalanced(org.orgId, 'adjustment void concurrency');
    await assertInventoryReconciled(org.orgId, 'adjustment void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: credit note reverses exactly once', () => {
  it('two concurrent credit-note voids → one wins, one conflicts, JE reversed once', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const cn = await prisma.creditNote.create({
      data: {
        organizationId: org.orgId, number: 'CN-VC', customerId, date: DATE, amount: 5000, applyTax: false,
        status: 'DRAFT', returnAccountId: org.accounts.salesRevenue, arAccountId: org.accounts.arControl,
      },
      select: { id: true },
    });
    await prisma.$transaction((tx) => postCreditNoteOnApply(tx, cn.id));
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidCreditNote(tx, org.orgId, cn.id, { date: DATE })),
      prisma.$transaction((tx) => voidCreditNote(tx, org.orgId, cn.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    expect(await journalEntryCount(org.orgId)).toBe(2);
    const after = await prisma.creditNote.findUnique({ where: { id: cn.id }, select: { status: true } });
    expect(after?.status).toBe('VOID');
    await assertTrialBalanced(org.orgId, 'credit note void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: debit note reverses exactly once', () => {
  it('two concurrent debit-note voids → one wins, one conflicts, JE reversed once', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const dn = await prisma.debitNote.create({
      data: {
        organizationId: org.orgId, number: 'DN-VC', vendorId, date: DATE, amount: 4000, applyTax: false,
        status: 'DRAFT', apAccountId: org.accounts.apControl, returnAccountId: org.accounts.cogsExpense,
      },
      select: { id: true },
    });
    await prisma.$transaction((tx) => postDebitNoteOnApply(tx, dn.id));
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidDebitNote(tx, org.orgId, dn.id, { date: DATE })),
      prisma.$transaction((tx) => voidDebitNote(tx, org.orgId, dn.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    expect(await journalEntryCount(org.orgId)).toBe(2);
    const after = await prisma.debitNote.findUnique({ where: { id: dn.id }, select: { status: true } });
    expect(after?.status).toBe('VOID');
    await assertTrialBalanced(org.orgId, 'debit note void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: sales return reverses exactly once', () => {
  it('two concurrent sales-return voids → one wins, one conflicts, JE reversed once', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const itemId = await createItem(org.orgId);
    const invoice = await prisma.salesInvoice.create({
      data: { organizationId: org.orgId, number: 'INV-SR-VC', customerId, issueDate: DATE, status: 'SENT' },
      select: { id: true },
    });
    const sr = await prisma.salesReturn.create({
      data: { organizationId: org.orgId, number: 'SR-VC', customerId, invoiceId: invoice.id, returnDate: DATE, status: 'DRAFT' },
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
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidSalesReturn(tx, org.orgId, sr.id, { date: DATE })),
      prisma.$transaction((tx) => voidSalesReturn(tx, org.orgId, sr.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    expect(await journalEntryCount(org.orgId)).toBe(2);
    const after = await prisma.salesReturn.findUnique({ where: { id: sr.id }, select: { status: true } });
    expect(after?.status).toBe('VOID');
    await assertTrialBalanced(org.orgId, 'sales return void concurrency');
    await assertInventoryReconciled(org.orgId, 'sales return void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: purchase return reverses exactly once', () => {
  it('two concurrent purchase-return voids → one wins, one conflicts, JE reversed once', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-PR-VC', vendorId, issueDate: DATE, status: 'OPEN' },
      select: { id: true },
    });
    await prisma.$transaction((tx) => addCostLayer(tx, org.orgId, itemId, null, 10, 100, InventoryDocumentType.PURCHASE, 'po-1', DATE));
    const pr = await prisma.purchaseReturn.create({
      data: { organizationId: org.orgId, number: 'PR-VC', vendorId, billId: bill.id, returnDate: DATE, status: 'DRAFT' },
      select: { id: true, number: true },
    });
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
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidPurchaseReturn(tx, org.orgId, pr.id, { date: DATE })),
      prisma.$transaction((tx) => voidPurchaseReturn(tx, org.orgId, pr.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    expect(await journalEntryCount(org.orgId)).toBe(2);
    const after = await prisma.purchaseReturn.findUnique({ where: { id: pr.id }, select: { status: true } });
    expect(after?.status).toBe('VOID');
    await assertTrialBalanced(org.orgId, 'purchase return void concurrency');
    await assertInventoryReconciled(org.orgId, 'purchase return void concurrency');

    await cleanupOrg(org.orgId);
  });
});
