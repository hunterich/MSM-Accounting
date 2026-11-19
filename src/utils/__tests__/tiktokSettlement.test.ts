import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseTikTokSettlement } from '../tiktokSettlement';

function fakeTikTok(): File {
  const detail: unknown[][] = [
    ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Jumlah penyelesaian pembayaran', 'Biaya komisi platform', 'Komisi Afiliasi', 'Diskon penjual'],
    ['ORD1', 'Pesanan', 44885, -3069, -2046, -1000],
    ['ADJ1', 'Pembayaran GMV untuk Iklan TikTok', -11100000, 0, 0, 0],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), 'Detail pesanan');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Laporan']]), 'Laporan');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'income_TIKTOK.xlsx');
}

describe('parseTikTokSettlement', () => {
  it('extracts Pesanan orders with mapped charges + net; reports non-order rows', async () => {
    const res = await parseTikTokSettlement(fakeTikTok());
    expect(res.orders).toHaveLength(1);
    const o = res.orders[0];
    expect(o.orderId).toBe('ORD1');
    expect(o.netReleased).toBe(44885);
    expect(o.charges.commissionFee).toBe(3069);
    expect(o.charges.serviceFee).toBe(2046);
    expect(o.charges.sellerPromotion).toBe(1000);
    expect(res.nonOrderRows).toEqual([{ orderId: 'ADJ1', type: 'Pembayaran GMV untuk Iklan TikTok', amount: -11100000 }]);
  });
  it('rejects a non-TikTok workbook', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Order ID']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await expect(parseTikTokSettlement(new File([buf], 'x.xlsx'))).rejects.toThrow();
  });
  it('captures the net refund once, without adding its before-discount components', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Jumlah penyelesaian pembayaran', 'Total pengembalian dana setelah diskon', 'Total pengembalian dana sebelum diskon', 'Pengembalian dana diskon penjual'],
      ['ORD2', 'Pesanan', -90, -90, -100, 10],
    ]), 'Detail pesanan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Laporan']]), 'Laporan');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const result = await parseTikTokSettlement(new File([buf], 'income.xlsx'));
    expect(result.orders[0].charges.refund).toBe(90);
  });
});
