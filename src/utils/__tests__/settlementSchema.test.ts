import { describe, it, expect } from 'vitest';
import { settlementImportInputSchema } from '@/types/api';

describe('settlementImportInputSchema', () => {
  it('accepts a settlement batch', () => {
    const r = settlementImportInputSchema.safeParse({
      orders: [{ orderId: 'ORD1', settlementDate: '2026-06-15', netReleased: 30832, charges: { commissionFee: 3069 } }],
    });
    expect(r.success).toBe(true);
  });
  it('defaults charges to {}', () => {
    const r = settlementImportInputSchema.safeParse({ orders: [{ orderId: 'ORD1', settlementDate: '2026-06-15', netReleased: 100 }] });
    expect(r.success).toBe(true);
  });
  it('rejects an empty orders array', () => {
    expect(settlementImportInputSchema.safeParse({ orders: [] }).success).toBe(false);
  });
  it('requires a real calendar date for payout, but not for a later refund reconciliation', () => {
    const order = { orderId: 'ORD1', netReleased: 100 };
    expect(settlementImportInputSchema.safeParse({ orders: [order] }).success).toBe(false);
    expect(settlementImportInputSchema.safeParse({ orders: [{ ...order, settlementDate: '2026-02-30' }] }).success).toBe(false);
    expect(settlementImportInputSchema.safeParse({ orders: [{ ...order, refundOnly: true }] }).success).toBe(true);
  });
});
