/**
 * GL invariant tests — run the REAL posting functions against a real Postgres
 * test database and assert whole-ledger invariants that mock-based unit tests
 * cannot reach (trial balance, subledger reconciliation, GR/IR clearing,
 * void-nets-to-zero, idempotency, period-lock atomicity, oversell block).
 *
 * Run with:  npm run test:int
 * Requires:  a reachable Postgres + a `<db>_test` database with the schema
 *            pushed (`DATABASE_URL=<test-url> npx prisma db push`).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { postBillToLedger } from '../../bill-posting';
import { postGoodsReceiptToLedger } from '../../goods-receipt-posting';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '../../payment-posting';
import { calculateAndPostCOGS } from '../../inventory-costing';
import { reverseJournalEntry } from '../../reverse-journal-entry';
import {
  prisma,
  createTestOrg,
  createVendor,
  createCustomer,
  createItem,
  assertTrialBalanced,
  accountBalance,
  inventoryLedgerValue,
  inventoryLotValue,
  journalEntryCount,
  cleanupOrg,
  disconnect,
  TOLERANCE,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-03-15T00:00:00.000Z');

describe('GL invariant: balanced posting + subledger reconciliation', () => {
  it('a manual-inventory bill posts balanced; AP, inventory GL, and the inventory ledger all reconcile', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: {
        organizationId: org.orgId,
        number: 'BILL-001',
        vendorId,
        issueDate: DATE,
        status: 'OPEN',
      },
      select: { id: true, number: true },
    });

    await prisma.$transaction((tx) =>
      postBillToLedger(tx, org.orgId, {
        id: bill.id,
        number: bill.number,
        issueDate: DATE,
        apAccountId: null,
        taxable: false,
        taxInclusive: false,
        taxRate: 0,
        lines: [
          {
            id: 'line-1',
            itemId,
            quantity: 10,
            price: 1000,
            lineTotal: 10000,
            purchaseOrderLineId: null,
          },
        ],
      }),
    );

    await assertTrialBalanced(org.orgId, 'manual bill');

    // AP control is credited the full bill value (debit-positive => negative).
    expect(accountBalance(org.orgId, org.accounts.apControl)).resolves.toBeCloseTo(-10000, 2);
    // Inventory GL is debited the full value.
    expect(accountBalance(org.orgId, org.accounts.inventoryAsset)).resolves.toBeCloseTo(10000, 2);
    // Inventory GL == ledger == open cost layers.
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(10000, 2);
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(10000, 2);

    await cleanupOrg(org.orgId);
  });

  it('a taxable bill splits net inventory and input tax, still balancing', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-TAX', vendorId, issueDate: DATE, status: 'OPEN' },
      select: { id: true, number: true },
    });

    // Tax-exclusive 11%: net 10000 + tax 1100 => AP 11100.
    await prisma.$transaction((tx) =>
      postBillToLedger(tx, org.orgId, {
        id: bill.id,
        number: bill.number,
        issueDate: DATE,
        apAccountId: null,
        taxable: true,
        taxInclusive: false,
        taxRate: 11,
        lines: [
          { id: 'l1', itemId, quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null },
        ],
      }),
    );

    await assertTrialBalanced(org.orgId, 'taxable bill');
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(10000, 2);
    expect(await accountBalance(org.orgId, org.accounts.apTax)).toBeCloseTo(1100, 2);
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(-11100, 2);

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: GR/IR clears to zero across receipt + bill', () => {
  it('goods receipt then bill leaves GR/IR at zero, inventory booked once', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-GRIR', vendorId, issueDate: DATE, status: 'OPEN' },
      select: { id: true, number: true },
    });

    // 1. Receive goods: Dr Inventory / Cr GR/IR + cost layer.
    await prisma.$transaction((tx) =>
      postGoodsReceiptToLedger(tx, org.orgId, {
        billId: bill.id,
        poNumber: 'PO-1',
        date: DATE,
        taxInclusive: false,
        taxRate: 0,
        lines: [{ itemId, quantity: 10, lineTotal: 10000 }],
      }),
    );

    // 2. Post the bill: stocked line clears GR/IR (receipt already booked).
    await prisma.$transaction((tx) =>
      postBillToLedger(tx, org.orgId, {
        id: bill.id,
        number: bill.number,
        issueDate: DATE,
        apAccountId: null,
        taxable: false,
        taxInclusive: false,
        taxRate: 0,
        lines: [
          { id: 'l1', itemId, quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null },
        ],
      }),
    );

    await assertTrialBalanced(org.orgId, 'gr/ir roundtrip');
    // GR/IR clearing nets to zero after both postings.
    expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBeCloseTo(0, 2);
    // Inventory booked exactly once (at receipt), AP raised at billing.
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(10000, 2);
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(-10000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(10000, 2);

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: payment posting is idempotent', () => {
  it('posting the same AR receipt twice creates exactly one journal entry', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const payment = await prisma.aRPayment.create({
      data: {
        organizationId: org.orgId,
        number: 'ARP-001',
        customerId,
        date: DATE,
        status: 'COMPLETED',
        totalAmount: 5000,
        depositAccountId: org.accounts.bankAsset,
        arAccountId: org.accounts.arControl,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) => postArPaymentIfNeeded(tx, org.orgId, payment.id));
    await prisma.$transaction((tx) => postArPaymentIfNeeded(tx, org.orgId, payment.id));

    expect(await journalEntryCount(org.orgId)).toBe(1);
    await assertTrialBalanced(org.orgId, 'ar idempotency');
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBeCloseTo(5000, 2);
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(-5000, 2);

    const after = await prisma.aRPayment.findUnique({
      where: { id: payment.id },
      select: { journalEntryId: true },
    });
    expect(after?.journalEntryId).toBeTruthy();

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: void/reversal nets to zero without orphaning the original', () => {
  it('reversing a posted AP payment leaves both entries, summing to zero', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const payment = await prisma.aPPayment.create({
      data: {
        organizationId: org.orgId,
        number: 'APP-001',
        vendorId,
        date: DATE,
        status: 'COMPLETED',
        totalAmount: 7500,
        apAccountId: org.accounts.apControl,
        cashAccountId: org.accounts.bankAsset,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) => postApPaymentIfNeeded(tx, org.orgId, payment.id));
    const posted = await prisma.aPPayment.findUnique({
      where: { id: payment.id },
      select: { journalEntryId: true },
    });
    const originalJeId = posted?.journalEntryId;
    expect(originalJeId).toBeTruthy();

    // Storno the payment's journal entry.
    await prisma.$transaction((tx) =>
      reverseJournalEntry(tx, originalJeId as string, { date: DATE, memo: 'Void APP-001' }),
    );

    // Original entry is untouched (append-only ledger), reversal is a new entry.
    expect(await journalEntryCount(org.orgId)).toBe(2);
    const original = await prisma.journalEntry.findUnique({
      where: { id: originalJeId as string },
      select: { status: true },
    });
    expect(original?.status).toBe('POSTED');

    // Every account nets back to zero; trial balance still balances.
    await assertTrialBalanced(org.orgId, 'reversal');
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(0, 2);
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBeCloseTo(0, 2);

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: period lock is atomic (throws and writes nothing)', () => {
  it('posting into a closed period throws and leaves no journal entry', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    await prisma.accountingPeriod.create({
      data: {
        organizationId: org.orgId,
        name: 'Mar 2026',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.000Z'),
        status: 'CLOSED',
      },
    });
    const payment = await prisma.aPPayment.create({
      data: {
        organizationId: org.orgId,
        number: 'APP-LOCK',
        vendorId,
        date: DATE,
        status: 'COMPLETED',
        totalAmount: 1000,
        apAccountId: org.accounts.apControl,
        cashAccountId: org.accounts.bankAsset,
      },
      select: { id: true },
    });

    await expect(
      prisma.$transaction((tx) => postApPaymentIfNeeded(tx, org.orgId, payment.id)),
    ).rejects.toThrow(/closed|locked/i);

    // Nothing was written: no JE, payment never linked.
    expect(await journalEntryCount(org.orgId)).toBe(0);
    const after = await prisma.aPPayment.findUnique({
      where: { id: payment.id },
      select: { journalEntryId: true },
    });
    expect(after?.journalEntryId).toBeNull();

    await cleanupOrg(org.orgId);
  });
});

describe('GL invariant: oversell is blocked', () => {
  it('COGS beyond on-hand throws and the inventory ledger stays consistent', async () => {
    const org = await createTestOrg();
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: { organizationId: org.orgId, number: 'BILL-STK', vendorId: await createVendor(org.orgId), issueDate: DATE, status: 'OPEN' },
      select: { id: true, number: true },
    });

    // Receive 5 units @ 1000.
    await prisma.$transaction((tx) =>
      postBillToLedger(tx, org.orgId, {
        id: bill.id,
        number: bill.number,
        issueDate: DATE,
        apAccountId: null,
        taxable: false,
        taxInclusive: false,
        taxRate: 0,
        lines: [{ id: 'l1', itemId, quantity: 5, price: 1000, lineTotal: 5000, purchaseOrderLineId: null }],
      }),
    );

    // Try to sell 10 (only 5 on hand, negative stock disabled) -> throws.
    await expect(
      prisma.$transaction((tx) =>
        calculateAndPostCOGS(tx, org.orgId, itemId, null, 10, InventoryDocumentType.SALES, 'inv-x', DATE),
      ),
    ).rejects.toThrow(/insufficient stock/i);

    // On-hand value still reflects the 5 received units; ledger == lots.
    expect(await inventoryLotValue(org.orgId)).toBeCloseTo(5000, 2);
    expect(await inventoryLedgerValue(org.orgId)).toBeCloseTo(5000, 2);

    await cleanupOrg(org.orgId);
  });
});
