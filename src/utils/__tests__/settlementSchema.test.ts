import { describe, it, expect } from 'vitest';
import { settlementImportInputSchema } from '@/types/api';

describe('settlementImportInputSchema', () => {
  it('accepts a settlement batch', () => {
    const r = settlementImportInputSchema.safeParse({
      orders: [{ orderId: 'ORD1', netReleased: 30832, charges: { commissionFee: 3069 } }],
    });
    expect(r.success).toBe(true);
  });
  it('defaults charges to {}', () => {
    const r = settlementImportInputSchema.safeParse({ orders: [{ orderId: 'ORD1', netReleased: 100 }] });
    expect(r.success).toBe(true);
  });
  it('rejects an empty orders array', () => {
    expect(settlementImportInputSchema.safeParse({ orders: [] }).success).toBe(false);
  });
});
