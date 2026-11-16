import { describe, expect, it } from 'vitest';
import { allocateAdjustmentOffsets } from '../stock-adjustment-allocation';

const movement = (value: number, accountId: string | null, inventoryAccountId = 'inventory') => ({ value, accountId, inventoryAccountId });

describe('stock adjustment offsets', () => {
  it('groups different accounts', () => {
    expect(allocateAdjustmentOffsets([movement(-10000, 'expense'), movement(-10000, 'receivable')], true, 'variance')).toEqual([{ accountId: 'expense', value: -10000 }, { accountId: 'receivable', value: -10000 }]);
  });
  it('nets increases and decreases by account', () => {
    expect(allocateAdjustmentOffsets([movement(25.01, 'expense'), movement(-10.02, 'expense')], true, 'variance')).toEqual([{ accountId: 'expense', value: 14.99 }]);
  });
  it('falls back for null selections', () => {
    expect(allocateAdjustmentOffsets([movement(-12, null)], true, 'variance')).toEqual([{ accountId: 'variance', value: -12 }]);
  });
  it('keeps legacy allocation on the variance default', () => {
    expect(allocateAdjustmentOffsets([movement(-10, 'expense'), movement(-20, 'receivable')], false, 'variance')).toEqual([{ accountId: 'variance', value: -30 }]);
  });
  it('rejects the inventory account as offset', () => {
    expect(() => allocateAdjustmentOffsets([movement(-1, 'inventory')], true, 'variance')).toThrowError(/cannot equal/);
  });
});
