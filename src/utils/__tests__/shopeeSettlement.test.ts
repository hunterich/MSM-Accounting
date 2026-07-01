import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseShopeeSettlement } from '../shopeeSettlement';

function fakeSettlement(): File {
  const income: unknown[][] = [
    ['Username (Seller)', 'From', 'to'], ['x', '2026-06-15', '2026-06-21'], [], [], ['subtotal(Rp)'],
    ['Sequence No.', 'Order ID', 'Commission fee', 'Service Fee', 'Total Released Amount (Rp)'],
    [1, 'ORD1', -3069, -2046, 30832],
    [2, 'ORD2', -1000, -500, 10000],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(income), 'Income');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Income Report']]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Note']]), 'Adjustment');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'Income.released.id.xlsx');
}

describe('parseShopeeSettlement', () => {
  it('extracts per-order net + canonical fee magnitudes', async () => {
    const res = await parseShopeeSettlement(fakeSettlement());
    expect(res.orders).toHaveLength(2);
    const o = res.orders[0];
    expect(o.orderId).toBe('ORD1');
    expect(o.netReleased).toBe(30832);
    expect(o.charges.commissionFee).toBe(3069); // abs magnitude
    expect(o.charges.serviceFee).toBe(2046);
    expect(res.totalNetReleased).toBe(40832);
    expect(res.nonOrderRows).toEqual([]);
  });
  it('rejects a non-settlement workbook', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Order ID']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await expect(parseShopeeSettlement(new File([buf], 'x.xlsx'))).rejects.toThrow();
  });
});
