/**
 * Concurrency invariants for the void / un-receive paths.
 *
 * Every void path historically did `findFirst` (no row lock, READ COMMITTED) →
 * reverse the journal entry / post a contra (a GL side effect) → plain `update`
 * to mark VOID/deleted. Two concurrent calls both pass the status check and both
 * run the reversal → the journal entry is reversed TWICE → corrupted ledger.
 *
 * The fix mirrors the approval engine (`approveRequest`): atomically CLAIM the
 * terminal status with a guarded `updateMany` and assert `count === 1` BEFORE
 * the side effect. The losing transaction blocks on the row lock, then sees the
 * row already claimed and rejects with 409.
 *
 * These tests fire two concurrent void/un-receive calls and assert:
 *   - exactly one fulfilled, one rejected (409),
 *   - the document reached its terminal state exactly once, and
 *   - the GL was reversed EXACTLY once (JE count 1 → 2, NOT 3) / the PO
 *     `receivedQty` decremented exactly once.
 *
 * Run with:  npm run test:int -- void-concurrency
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '../../bill-posting';
import { postGoodsReceiptToLedger } from '../../goods-receipt-posting';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '../../payment-posting';
import { voidArPayment, voidApPayment } from '../../payment-void';
import { voidBill } from '../../bill-void';
import { unreceiveGoodsReceipt } from '../../unreceive-goods';
import {
  prisma,
  createTestOrg,
  createVendor,
  createCustomer,
  createItem,
  assertTrialBalanced,
  journalEntryCount,
  cleanupOrg,
  disconnect,
  TOLERANCE,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-03-15T00:00:00.000Z');

/** Count of settled/rejected results, with the rejection reasons surfaced. */
function tally(results: PromiseSettledResult<unknown>[]) {
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  return { fulfilled, rejected };
}

/**
 * Assert the losing void was correctly blocked. Two valid "already voided"
 * outcomes — and the race decides which:
 *   - 409 when the loser passed its pre-claim read (winner not yet committed),
 *     then lost the atomic claim's row lock (the race guard fired); or
 *   - 422 when the loser's pre-claim read happened to run after the winner
 *     committed, so it saw the terminal state and rejected early.
 * Both prevent the double-reversal — the load-bearing assertion is the JE count.
 */
function expectConflict(reason: unknown) {
  const status = (reason as { status?: number }).status;
  expect([409, 422]).toContain(status);
}

describe('void concurrency: AR receipt void reverses the ledger exactly once', () => {
  it('two concurrent AR voids → one wins, one 409s, JE reversed once', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);
    const payment = await prisma.aRPayment.create({
      data: {
        organizationId: org.orgId,
        number: 'ARP-VC',
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
    expect(await journalEntryCount(org.orgId)).toBe(1); // exactly one posting entry

    // Fire two concurrent voids. Each runs in its own transaction so the row
    // lock taken by the atomic claim is what serializes them.
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidArPayment(tx, org.orgId, payment.id, { date: DATE })),
      prisma.$transaction((tx) => voidArPayment(tx, org.orgId, payment.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    // Reversed EXACTLY once: original + one reversal = 2 (a double-reverse = 3).
    expect(await journalEntryCount(org.orgId)).toBe(2);

    const after = await prisma.aRPayment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(after?.status).toBe('VOID');

    const report = await assertTrialBalanced(org.orgId, 'ar void concurrency');
    expect(Math.abs(report.summary.endingDebit - report.summary.endingCredit)).toBeLessThanOrEqual(TOLERANCE);

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: AP payment void reverses the ledger exactly once', () => {
  it('two concurrent AP voids → one wins, one 409s, JE reversed once', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const payment = await prisma.aPPayment.create({
      data: {
        organizationId: org.orgId,
        number: 'APP-VC',
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
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidApPayment(tx, org.orgId, payment.id, { date: DATE })),
      prisma.$transaction((tx) => voidApPayment(tx, org.orgId, payment.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    expect(await journalEntryCount(org.orgId)).toBe(2);

    const after = await prisma.aPPayment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(after?.status).toBe('VOID');

    await assertTrialBalanced(org.orgId, 'ap void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: bill void reverses the ledger exactly once', () => {
  it('two concurrent bill voids → one wins, one 409s, JE reversed once', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const bill = await prisma.bill.create({
      data: {
        organizationId: org.orgId,
        number: 'BILL-VC',
        vendorId,
        issueDate: DATE,
        status: 'OPEN',
      },
      select: { id: true, number: true },
    });

    // Post a manual-inventory bill so it owns exactly one journal entry.
    await prisma.$transaction(async (tx) => {
      await postBillToLedger(tx, org.orgId, {
        id: bill.id,
        number: bill.number,
        issueDate: DATE,
        apAccountId: null,
        taxable: false,
        taxInclusive: false,
        taxRate: 0,
        lines: [{ id: 'l1', itemId, quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: null }],
      });
      // postBillToLedger does not set bill.journalEntryId; mirror what the
      // create route does so voidBill resolves the posting entry directly.
      const je = await tx.journalEntry.findFirst({
        where: { organizationId: org.orgId, memo: `Bill: ${bill.number}` },
        select: { id: true },
      });
      await tx.bill.update({ where: { id: bill.id }, data: { journalEntryId: je?.id } });
    });
    expect(await journalEntryCount(org.orgId)).toBe(1);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => voidBill(tx, org.orgId, bill.id, { date: DATE })),
      prisma.$transaction((tx) => voidBill(tx, org.orgId, bill.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    // Original posting + ONE reversal = 2 (double-reverse would be 3).
    expect(await journalEntryCount(org.orgId)).toBe(2);

    const after = await prisma.bill.findUnique({
      where: { id: bill.id },
      select: { status: true, voidedAt: true },
    });
    expect(after?.status).toBe('VOID');
    expect(after?.voidedAt).toBeTruthy();

    await assertTrialBalanced(org.orgId, 'bill void concurrency');

    await cleanupOrg(org.orgId);
  });
});

describe('void concurrency: goods-receipt un-receive reverses exactly once', () => {
  it('two concurrent un-receives → one wins, one 409s, PO receivedQty decremented once', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);

    // PO with one line, fully received (10 units).
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: org.orgId,
        number: 'PO-VC',
        vendorId,
        date: DATE,
        status: 'CLOSED',
        lines: {
          create: [
            { lineNo: 1, itemId, description: 'Widget', quantity: 10, price: 1000, lineTotal: 10000, receivedQty: 10 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    const poLineId = po.lines[0].id;

    // Draft goods-receipt bill linked to the PO + booked inventory/GR-IR.
    const bill = await prisma.bill.create({
      data: {
        organizationId: org.orgId,
        number: 'GR-VC',
        vendorId,
        poId: po.id,
        issueDate: DATE,
        status: 'DRAFT',
        lines: {
          create: [
            { lineNo: 1, itemId, description: 'Widget', quantity: 10, price: 1000, lineTotal: 10000, purchaseOrderLineId: poLineId },
          ],
        },
      },
      select: { id: true, number: true },
    });

    await prisma.$transaction((tx) =>
      postGoodsReceiptToLedger(tx, org.orgId, {
        billId: bill.id,
        poNumber: po.id,
        date: DATE,
        taxInclusive: false,
        taxRate: 0,
        lines: [{ itemId, quantity: 10, lineTotal: 10000 }],
      }),
    );
    expect(await journalEntryCount(org.orgId)).toBe(1); // the receipt's posting entry

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => unreceiveGoodsReceipt(tx, org.orgId, bill.id, { date: DATE })),
      prisma.$transaction((tx) => unreceiveGoodsReceipt(tx, org.orgId, bill.id, { date: DATE })),
    ]);

    const { fulfilled, rejected } = tally(results);
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(1);
    expectConflict(rejected[0].reason);

    // Exactly ONE contra JE posted: receipt + one un-receive contra = 2.
    expect(await journalEntryCount(org.orgId)).toBe(2);

    // PO receivedQty decremented exactly ONCE: 10 → 0, NOT 10 → -10.
    const poLine = await prisma.purchaseOrderLine.findUnique({
      where: { id: poLineId },
      select: { receivedQty: true },
    });
    expect(Number(poLine?.receivedQty)).toBeCloseTo(0, 4);

    const after = await prisma.bill.findUnique({
      where: { id: bill.id },
      select: { deletedAt: true },
    });
    expect(after?.deletedAt).toBeTruthy();

    await assertTrialBalanced(org.orgId, 'unreceive concurrency');

    await cleanupOrg(org.orgId);
  });
});
