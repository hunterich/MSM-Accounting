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
  it('reads order rows across split income sheets, ignoring SKU rows and retaining payout dates and adjustments', async () => {
    const wb = XLSX.utils.book_new();
    const header = ['View By', 'Order ID', 'Payout Completed Date', 'Total Released Amount (Rp)', 'Product Price', 'Refund Amount', 'Commission fee (including PPN 10%)', 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)', 'WHT 22'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ['Order', 'O100', '2026-10-12', 80, 100, -10, -5, -3, -2], ['Sku', 'O100', '2026-10-12', 80, 100, -10, -5, -3, -2]]), 'Income - 1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ['Order', 'O101', '2026-10-13', 50, 50, 0, 0, 0, 0]]), 'Income - 2');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary']]), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Sequence No.', 'Adjustment Amount', 'Linked Order No.', 'Adjustment Type | Description'], [1, -12, 'O100', 'Adjustment'], ['Total Amount', -12]]), 'Adjustment');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const result = await parseShopeeSettlement(new File([buf], 'income.xlsx'));
    expect(result.orders).toHaveLength(2);
    expect(result.orders[0]).toMatchObject({ orderId: 'O100', settlementDate: '2026-10-12', requireMappedCharges: true, charges: { refund: 10, commissionFee: 5, freeShippingXtraFee: 3, customTax: 2 } });
    expect(result.orders[1].settlementDate).toBe('2026-10-13');
    expect(result.nonOrderRows).toEqual([{ orderId: 'O100', type: 'Adjustment', amount: -12 }]);
  });
  it('rejects unsupported nonzero fee columns instead of hiding them in adjustments', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['View By', 'Order ID', 'Payout Completed Date', 'Total Released Amount (Rp)', 'Product Price', 'New Fee', 'WHT 22'],
      ['Order', 'O100', '2026-10-12', 90, 100, -10, 0],
    ]), 'Income - 1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary']]), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Adjustment']]), 'Adjustment');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await expect(parseShopeeSettlement(new File([buf], 'income.xlsx'))).rejects.toThrow('Unmapped financial column New Fee');
  });
});
