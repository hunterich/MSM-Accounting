import { describe, it, expect } from 'vitest';
import { SHOPEE_COLUMN_TO_KEY, KEY_TO_SLOT, TIKTOK_COLUMN_TO_KEY } from '../settlementMapping';

describe('settlement mapping', () => {
  it('routes a Shopee column to a canonical key to a ShopMappings slot', () => {
    expect(SHOPEE_COLUMN_TO_KEY['commissionfee']).toBe('commissionFee');
    expect(SHOPEE_COLUMN_TO_KEY['servicefee']).toBe('serviceFee');
    expect(KEY_TO_SLOT['commissionFee']).toEqual(['fees', 'platformFeeAccountId']);
    expect(KEY_TO_SLOT['serviceFee']).toEqual(['fees', 'affiliateFeeAccountId']);
    expect(KEY_TO_SLOT['buyerShipping']).toEqual(['shipping', 'buyerShippingRevenueAccountId']);
  });

  it('maps TikTok Indonesian columns to canonical keys', () => {
    expect(TIKTOK_COLUMN_TO_KEY['biayakomisiplatform']).toBe('commissionFee');
    expect(TIKTOK_COLUMN_TO_KEY['komisiafiliasi']).toBe('serviceFee');
    expect(TIKTOK_COLUMN_TO_KEY['biayapembayaran']).toBe('transactionFee');
    expect(TIKTOK_COLUMN_TO_KEY['biayapemrosesanpesanan']).toBe('orderProcessingFee');
    expect(TIKTOK_COLUMN_TO_KEY['diskonpenjual']).toBe('sellerPromotion');
    expect(TIKTOK_COLUMN_TO_KEY['pphpasal22dipungut']).toBe('customTax');
  });
});
