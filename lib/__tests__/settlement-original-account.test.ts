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
vi.mock('@/lib/journal-posting', () => ({ postJournalEntry: state.post, BALANCE_TOLERANCE: 0.005 }));
vi.mock('@/lib/period-guard', () => ({ assertPeriodOpen: state.guard }));
import { importSettlement } from '../settlement-import';

describe('marketplace settlement original account', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.prisma.ecommerceConnection.findFirst.mockResolvedValue({ holdingAccountId: 'new-wallet', mappings: { fees: { adjustmentAccountId: 'adjustment' } } });
    state.tx.salesInvoice.findFirst.mockResolvedValue({ id: 'invoice', number: 'INV1', totalAmount: 100 });
    state.tx.aRPaymentAllocation.findFirst.mockResolvedValue({ paymentId: 'receipt' });
    state.tx.aRPayment.findFirst.mockResolvedValue({ id: 'receipt', settledAt: null, depositAccountId: 'original-wallet-gl', journalEntryId: 'receipt-journal' });
    state.post.mockResolvedValue({ id: 'settlement-journal' });
    state.tx.creditNote.updateMany.mockResolvedValue({ count: 1 });
  });
  it('credits the receipt account after the connection account changes', async () => {
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', netReleased: 90, charges: {} }] });
    expect(result.posted).toBe(1);
    expect(state.tx.aRPayment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', ecommerceConnectionId: 'connection', source: 'MARKETPLACE_IMPORT' }) }));
    const lines = state.post.mock.calls[0][1].lines;
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'original-wallet-gl', credit: 10 }));
    expect(lines.some((line: any) => line.accountId === 'new-wallet')).toBe(false);
  });
  it('does not post when the original receipt account is missing', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ id: 'receipt', settledAt: null, depositAccountId: null, journalEntryId: 'receipt-journal' });
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', netReleased: 90, charges: {} }] });
    expect(result.failed).toHaveLength(1);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.aRPayment.update).not.toHaveBeenCalled();
  });
  it('reports an allocated receipt with unverifiable provenance for review', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue(null);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'legacy-order', netReleased: 90, charges: {} }] });
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([{ orderId: 'legacy-order', reason: expect.stringContaining('review its provenance') }]);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.aRPayment.update).not.toHaveBeenCalled();
  });
  it('keeps legacy receipts in the review bucket when no verified import allocation exists', async () => {
    state.tx.aRPaymentAllocation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ paymentId: 'legacy' });
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', netReleased: 90, charges: {} }] });
    expect(result.skipped).toEqual([]);
    expect(result.failed[0].reason).toContain('review its provenance');
    expect(state.post).not.toHaveBeenCalled();
  });

  const refundNote = { id: 'cn', amount: 30, marketplaceRefundReceiptId: null };
  it('reconciles a first-settlement refund without booking it as an expense twice', async () => {
    state.tx.creditNote.findMany.mockResolvedValue([refundNote]);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{
      orderId: 'order', netReleased: 60, charges: { refund: 30, commissionFee: 10 }, refundCreditNoteNumbers: ['CN1'],
    }] });
    expect(result.failed).toEqual([]);
    expect(result.posted).toBe(1);
    const lines = state.post.mock.calls[0][1].lines;
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'original-wallet-gl', credit: 10 }));
    expect(lines.some((line: any) => line.description.startsWith('refund'))).toBe(false);
    expect(state.tx.creditNote.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ marketplaceRefundReceiptId: 'receipt' }) }));
  });
  it('links a refund after settlement without another journal, and replay is idempotent', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ id: 'receipt', settledAt: new Date(), depositAccountId: 'original-wallet-gl', journalEntryId: 'receipt-journal' });
    state.tx.creditNote.findMany.mockResolvedValue([refundNote]);
    const input = { orders: [{ orderId: 'order', netReleased: -30, charges: { refund: 30 }, refundOnly: true, refundCreditNoteNumbers: ['CN1'] }] };
    const result = await importSettlement('org', 'user', 'connection', input);
    expect(result.posted).toBe(1);
    expect(state.post).not.toHaveBeenCalled();
    state.tx.creditNote.findMany.mockResolvedValue([{ ...refundNote, marketplaceRefundReceiptId: 'receipt' }]);
    const replay = await importSettlement('org', 'user', 'connection', input);
    expect(replay.alreadySettled).toBe(1);
    expect(state.tx.creditNote.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    { notes: [], numbers: ['CN1'], refund: 30 },
    { notes: [refundNote], numbers: ['CN1'], refund: 40 },
    { notes: [{ ...refundNote, marketplaceRefundReceiptId: 'another-receipt' }], numbers: ['CN1'], refund: 30 },
    { notes: [refundNote], numbers: [], refund: 30 },
  ])('blocks an unverified, mismatched, reused or unlinked refund', async ({ notes, numbers, refund }) => {
    state.tx.creditNote.findMany.mockResolvedValue(notes);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', netReleased: 60, charges: { refund }, refundCreditNoteNumbers: numbers }] });
    expect(result.failed).toHaveLength(1);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.creditNote.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a later refund row containing the original payout or other fees', async () => {
    state.tx.aRPayment.findFirst.mockResolvedValue({ id: 'receipt', settledAt: new Date(), depositAccountId: 'original-wallet-gl', journalEntryId: 'receipt-journal' });
    state.tx.creditNote.findMany.mockResolvedValue([refundNote]);
    const result = await importSettlement('org', 'user', 'connection', { orders: [{ orderId: 'order', netReleased: 60, charges: { refund: 30 }, refundOnly: true, refundCreditNoteNumbers: ['CN1'] }] });
    expect(result.failed).toHaveLength(1);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.tx.creditNote.updateMany).not.toHaveBeenCalled();
  });
});
