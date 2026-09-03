/**
 * voidApPayment / voidArPayment reverse a posted payment's journal entry,
 * remove its allocations (so the settled bills/invoices revert), and mark the
 * payment VOID. Unposted (no journalEntryId) payments cannot be voided.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-000099' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { voidApPayment, voidArPayment } from '../payment-void';

const DATE = new Date('2026-06-14');

function makeApTx(payment: any, claimCount = 1) {
  return {
    aPPayment: {
      findFirst: vi.fn(async () => payment),
      updateMany: vi.fn(async () => ({ count: claimCount })),
    },
    aPPaymentAllocation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
}
function makeArTx(payment: any, claimCount = 1) {
  return {
    aRPayment: {
      findFirst: vi.fn(async () => payment),
      updateMany: vi.fn(async () => ({ count: claimCount })),
    },
    aRPaymentAllocation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
}

const apPaid = (over: any = {}) => ({ id: 'pay-1', number: 'PAY-0001', status: 'COMPLETED', journalEntryId: 'je-1', ...over });
const arPaid = (over: any = {}) => ({ id: 'rcpt-1', number: 'RCPT-0001', status: 'COMPLETED', journalEntryId: 'je-2', ...over });

describe('voidApPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE, clears allocations, and marks VOID', async () => {
    const tx = makeApTx(apPaid());
    await voidApPayment(tx as never, 'org-a', 'pay-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    // VOID is claimed atomically BEFORE the reversal (the race guard).
    expect((tx.aPPayment.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: { id: 'pay-1', status: { not: 'VOID' } },
      data: { status: 'VOID' },
    });
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect(tx.aPPaymentAllocation.deleteMany).toHaveBeenCalledWith({ where: { paymentId: 'pay-1' } });
  });

  it('rejects 409 if a concurrent void already claimed VOID (claim count 0)', async () => {
    const tx = makeApTx(apPaid(), 0);
    await expect(voidApPayment(tx as never, 'org-a', 'pay-1', { date: DATE })).rejects.toThrow(/already void/i);
    // The claim ran but lost the race, so the reversal must NOT run.
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('throws 404 when the payment does not exist', async () => {
    const tx = makeApTx(null);
    await expect(voidApPayment(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an already-voided payment', async () => {
    const tx = makeApTx(apPaid({ status: 'VOID' }));
    await expect(voidApPayment(tx as never, 'org-a', 'pay-1', { date: DATE })).rejects.toThrow(/already void/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an unposted payment (no journal entry) — delete it instead', async () => {
    const tx = makeApTx(apPaid({ journalEntryId: null, status: 'DRAFT' }));
    await expect(voidApPayment(tx as never, 'org-a', 'pay-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(tx.aPPayment.updateMany).not.toHaveBeenCalled();
  });
});

describe('voidArPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE, clears allocations, and marks VOID', async () => {
    const tx = makeArTx(arPaid());
    await voidArPayment(tx as never, 'org-a', 'rcpt-1', { date: DATE });

    expect((tx.aRPayment.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: { id: 'rcpt-1', status: { not: 'VOID' } },
      data: { status: 'VOID' },
    });
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-2', expect.objectContaining({ date: DATE }));
    expect(tx.aRPaymentAllocation.deleteMany).toHaveBeenCalledWith({ where: { paymentId: 'rcpt-1' } });
  });
});
