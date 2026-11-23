import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const tx: any = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    creditNote: { findMany: vi.fn(), updateMany: vi.fn() },
    salesInvoice: { findFirst: vi.fn() },
    aRPaymentAllocation: { findFirst: vi.fn() },
    aRPayment: { findFirst: vi.fn(), update: vi.fn() },
  };
  return { tx, prisma: { ecommerceConnection: { findFirst: vi.fn() }, $transaction: vi.fn(async (fn: any) => fn(tx)) }, post: vi.fn(), guard: vi.fn() };
});
vi.mock('@/lib/prisma', () => ({ prisma: state.prisma }));
vi.mock('@/lib/journal-posting', () => ({ postJournalEntry: state.post }));
vi.mock('@/lib/period-guard', () => ({ assertPeriodOpen: state.guard }));
import { importSettlement } from '../settlement-import';

describe('marketplace settlement original account', () => {
  const receipt = { id: 'receipt', settledAt: null, depositAccountId: 'original-wallet-gl', journalEntryId: 'receipt-journal', totalAmount: 100 };

  function postedAmount(accountId: string, side: 'debit' | 'credit'): number {
    return Number(state.post.mock.calls[0][1].lines.find((line: { accountId: string }) => line.accountId === accountId)?.[side]);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    state.prisma.ecommerceConnection.findFirst.mockResolvedValue({ holdingAccountId: 'new-wallet', mappings: { fees: { adjustmentAccountId: 'adjustment', platformFeeAccountId: 'platform-fee' } } });
    state.tx.salesInvoice.findFirst.mockResolvedValue({ id: 'invoice', number: 'INV1', totalAmount: 100 });
    state.tx.aRPaymentAllocation.findFirst.mockResolvedValue({ paymentId: 'receipt', amountApplied: 100 });
    state.tx.aRPayment.findFirst.mockResolvedValue(receipt);
    state.post.mockResolvedValue({ id: 'settlement-journal' });
    state.tx.creditNote.updateMany.mockResolvedValue({ count: 1 });
  });
  it('posts on the statement calendar date and rejects a closed period', async () => {
    const input = { orders: [{ orderId: 'order', settlementDate: '2026-01-31', netReleased: 90, charges: { commissionFee: 10 } }] };
    expect((await importSettlement('org', 'user', 'connection', input)).posted).toBe(1);
    const date = new Date('2026-01-31T00:00:00.000Z');
    expect(state.guard).toHaveBeenCalledWith(state.tx, 'org', date);
    expect(state.post).toHaveBeenCalledWith(state.tx, expect.objectContaining({ date }));
    state.post.mockClear();
    state.guard.mockRejectedValueOnce(new Error('closed/locked'));
    const closed = await importSettlement('org', 'user', 'connection', input);
    expect(closed.failed[0].reason).toContain('closed/locked');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('rejects missing and invalid settlement dates before posting', async () => {
    for (const settlementDate of [undefined, '2026-02-30']) {
      const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', settlementDate, netReleased: 90, charges: { commissionFee: 10 } }] });
      expect(result.failed[0].reason).toContain('actual settlement date');
    }
    expect(state.post).not.toHaveBeenCalled();
  });
  it('credits the receipt account after the connection account changes', async () => {
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: 90, charges: { commissionFee: 10 } }] });
    expect(result.posted).toBe(1);
    expect(state.tx.aRPayment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', ecommerceConnectionId: 'connection', source: 'MARKETPLACE_IMPORT' }) }));
    const lines = state.post.mock.calls[0][1].lines;
    expect(postedAmount('original-wallet-gl', 'credit')).toBe(10);
    expect(lines.some((line: any) => line.accountId === 'new-wallet')).toBe(false);
  });
  it('does not post when the original receipt account is missing', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ ...receipt, depositAccountId: null });
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: 90, charges: {} }] });
    expect(result.failed).toHaveLength(1);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.aRPayment.update).not.toHaveBeenCalled();
  });
  it('requires the configured Growth Xtra account and posts the fee to it', async () => {
    const input = { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: 90, charges: { growthXtraFee: 10 } }] };
    const missing = await importSettlement('org', 'user', 'connection', input);
    expect(missing.failed[0].reason).toContain('Growth Xtra fee account');
    expect(state.post).not.toHaveBeenCalled();
    state.prisma.ecommerceConnection.findFirst.mockResolvedValue({ holdingAccountId: 'wallet', mappings: { fees: { adjustmentAccountId: 'adjustment', growthXtraAccountId: 'growth-expense' } } });
    expect((await importSettlement('org', 'user', 'connection', input)).posted).toBe(1);
    expect(postedAmount('growth-expense', 'debit')).toBe(10);
  });
  it('requires explicit fee accounts and rejects an unexplained difference for strict imports', async () => {
    const order = { orderId: 'order', settlementDate: '2026-06-15', netReleased: 90, charges: { freeShippingXtraFee: 10 }, requireMappedCharges: true };
    const missing = await importSettlement('org', 'user', 'connection', { orders: [order] });
    expect(missing.failed[0].reason).toContain('freeShippingXtraFee');
    expect(state.post).not.toHaveBeenCalled();
    state.prisma.ecommerceConnection.findFirst.mockResolvedValue({ holdingAccountId: 'wallet', mappings: { fees: { adjustmentAccountId: 'adjustment', freeShippingXtraAccountId: 'shipping-fee' } } });
    const different = await importSettlement('org', 'user', 'connection', { orders: [{ ...order, netReleased: 89 }] });
    expect(different.failed[0].reason).toContain('review the source documents');
    expect(state.post).not.toHaveBeenCalled();
    const valid = await importSettlement('org', 'user', 'connection', { orders: [order] });
    expect(valid.posted).toBe(1);
    expect(postedAmount('shipping-fee', 'debit')).toBe(10);
  });
  it('permits a legacy adjustment when the caller explicitly opts in', async () => {
    const order = { orderId: 'order', settlementDate: '2026-06-15', netReleased: '99.99', charges: {} };
    expect((await importSettlement('org', 'user', 'connection', { orders: [order] })).failed[0].reason).toContain('0.01');
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ ...order, requireMappedCharges: false }] });
    expect(result.posted).toBe(1);
    expect(postedAmount('adjustment', 'debit')).toBe(0.01);
  });
  it('keeps an invoice and receipt allocation that differ by Rp0.01 open for review', async () => {
    state.tx.aRPaymentAllocation.findFirst.mockResolvedValue({ paymentId: 'receipt', amountApplied: '99.99' });
    const order = { orderId: 'order', settlementDate: '2026-06-15', netReleased: 100, charges: {} };
    const result = await importSettlement('org', 'user', 'connection', { orders: [order] });
    expect(result.failed[0].reason).toContain('saved invoice, original marketplace receipt and allocation differ');
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.aRPayment.update).not.toHaveBeenCalled();
  });
  it('reports an allocated receipt with unverifiable provenance for review', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue(null);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'legacy-order', settlementDate: '2026-06-15', netReleased: 90, charges: {} }] });
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([{ orderId: 'legacy-order', reason: expect.stringContaining('review its provenance') }]);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.aRPayment.update).not.toHaveBeenCalled();
  });
  it('keeps legacy receipts in the review bucket when no verified import allocation exists', async () => {
    state.tx.aRPaymentAllocation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ paymentId: 'legacy' });
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: 90, charges: {} }] });
    expect(result.skipped).toEqual([]);
    expect(result.failed[0].reason).toContain('review its provenance');
    expect(state.post).not.toHaveBeenCalled();
  });

  const refundNote = { id: 'cn', amount: 30, marketplaceRefundReceiptId: null };
  it('reconciles a first-settlement refund without booking it as an expense twice', async () => {
    state.tx.creditNote.findMany.mockResolvedValue([refundNote]);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{
      orderId: 'order', settlementDate: '2026-06-15', netReleased: 60, charges: { refund: 30, commissionFee: 10 }, refundCreditNoteNumbers: ['CN1'],
    }] });
    expect(result.failed).toEqual([]);
    expect(result.posted).toBe(1);
    const lines = state.post.mock.calls[0][1].lines;
    expect(postedAmount('original-wallet-gl', 'credit')).toBe(10);
    expect(lines.some((line: any) => line.description.startsWith('refund'))).toBe(false);
    expect(state.tx.creditNote.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ marketplaceRefundReceiptId: 'receipt' }) }));
  });
  it('links a refund after settlement without another journal, and replay is idempotent', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ ...receipt, settledAt: new Date() });
    state.tx.creditNote.findMany.mockResolvedValue([refundNote]);
    const input = { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: -30, charges: { refund: 30 }, refundOnly: true, refundCreditNoteNumbers: ['CN1'] }] };
    const result = await importSettlement('org', 'user', 'connection', input);
    expect(result.posted).toBe(1);
    expect(state.post).not.toHaveBeenCalled();
    state.tx.creditNote.findMany.mockResolvedValue([{ ...refundNote, marketplaceRefundReceiptId: 'receipt' }]);
    const replay = await importSettlement('org', 'user', 'connection', input);
    expect(replay.alreadySettled).toBe(1);
    expect(state.tx.creditNote.updateMany).toHaveBeenCalledTimes(1);
  });
  it('matches a later refund and its negative payout at the precision of the credit note', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ ...receipt, settledAt: new Date() });
    state.tx.creditNote.findMany.mockResolvedValue([{ ...refundNote, amount: '0.01' }]);
    const order = { orderId: 'order', netReleased: '-0.005', charges: { refund: '0.005' }, refundOnly: true, refundCreditNoteNumbers: ['CN1'] };
    const mismatch = await importSettlement('org', 'user', 'connection', { orders: [{ ...order, netReleased: '-0.004' }] });
    expect(mismatch.failed).toHaveLength(1);
    expect(state.tx.creditNote.updateMany).not.toHaveBeenCalled();
    expect((await importSettlement('org', 'user', 'connection', { orders: [order] })).posted).toBe(1);
    expect(state.tx.creditNote.updateMany).toHaveBeenCalledTimes(1);
    expect(state.post).not.toHaveBeenCalled();
  });
  it.each([
    { notes: [], numbers: ['CN1'], refund: 30 },
    { notes: [refundNote], numbers: ['CN1'], refund: 40 },
    { notes: [{ ...refundNote, marketplaceRefundReceiptId: 'another-receipt' }], numbers: ['CN1'], refund: 30 },
    { notes: [refundNote], numbers: [], refund: 30 },
  ])('blocks an unverified, mismatched, reused or unlinked refund', async ({ notes, numbers, refund }) => {
    state.tx.creditNote.findMany.mockResolvedValue(notes);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: 60, charges: { refund }, refundCreditNoteNumbers: numbers }] });
    expect(result.failed).toHaveLength(1);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.creditNote.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a later refund row containing the original payout or other fees', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ ...receipt, settledAt: new Date() });
    state.tx.creditNote.findMany.mockResolvedValue([refundNote]);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', settlementDate: '2026-06-15', netReleased: 60, charges: { refund: 30 }, refundOnly: true, refundCreditNoteNumbers: ['CN1'] }] });
    expect(result.failed).toHaveLength(1);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.creditNote.updateMany).not.toHaveBeenCalled();
  });
});
