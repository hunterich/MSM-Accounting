import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const tx: any = {
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
});

