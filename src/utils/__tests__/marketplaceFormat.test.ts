import { describe, it, expect } from 'vitest';
import { detectPlatformFromHeaders } from '../marketplaceFormat';

describe('detectPlatformFromHeaders', () => {
  it('detects Shopee from its Indonesian headers', () => {
    expect(detectPlatformFromHeaders(['No. Pesanan','Status Pesanan','SKU Induk','Nama Produk','Nomor Referensi SKU','Jumlah'], 'Matched Orders')).toBe('Shopee');
  });
  it('detects TikTok from its English headers', () => {
    expect(detectPlatformFromHeaders(['Order ID','Order Status','Seller SKU','Product Name','Quantity'], 'Filtered Adjusted')).toBe('TikTok');
  });
  it('returns null for an unrecognized file', () => {
    expect(detectPlatformFromHeaders(['Foo','Bar'], 'Sheet1')).toBeNull();
  });
});
