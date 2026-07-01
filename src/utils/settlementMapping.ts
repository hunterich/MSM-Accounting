export type SettlementFeeKey =
  | 'commissionFee' | 'serviceFee' | 'orderProcessingFee' | 'transactionFee' | 'campaignFee'
  | 'sellerPromotion' | 'refund' | 'buyerShipping' | 'actualShipping' | 'shippingRebate'
  | 'sellerVoucher' | 'platformRebate' | 'coinCashback' | 'customTax';

// Shopee Income-sheet column header (normalized: lowercased, non-alphanumerics stripped) → canonical key
export const SHOPEE_COLUMN_TO_KEY: Record<string, SettlementFeeKey> = {
  amscommissionfee: 'commissionFee', commissionfee: 'commissionFee',
  servicefee: 'serviceFee', sellerorderprocessingfee: 'orderProcessingFee',
  transactionfee: 'transactionFee', campaignfee: 'campaignFee',
  yoursellerproductpromotion: 'sellerPromotion', refundamount: 'refund',
  shippingfeepaidbybuyer: 'buyerShipping', actualshippingfee: 'actualShipping',
  shippingrebatefromshopee: 'shippingRebate',
  vouchersponsoredbyseller: 'sellerVoucher', rebateprovidedbyshopee: 'platformRebate',
  coincashbacksponsoredbyseller: 'coinCashback', customtax: 'customTax',
};

// canonical key → [ShopMappings group, field]. The actual GL account lives in mappings[group][field],
// configured by the operator on the integration form.
export const KEY_TO_SLOT: Record<SettlementFeeKey, ['fees' | 'shipping' | 'others', string]> = {
  commissionFee: ['fees', 'platformFeeAccountId'], serviceFee: ['fees', 'affiliateFeeAccountId'],
  orderProcessingFee: ['fees', 'platformFeeAccountId'], transactionFee: ['fees', 'platformFeeAccountId'],
  campaignFee: ['fees', 'platformFeeAccountId'], sellerPromotion: ['fees', 'sellerDiscountAccountId'],
  refund: ['others', 'refundAccountId'], buyerShipping: ['shipping', 'buyerShippingRevenueAccountId'],
  actualShipping: ['shipping', 'actualShippingCostAccountId'], shippingRebate: ['shipping', 'platformShippingSubsidyAccountId'],
  sellerVoucher: ['others', 'sellerVoucherAccountId'], platformRebate: ['others', 'platformVoucherAccountId'],
  coinCashback: ['others', 'coinCashbackAccountId'], customTax: ['others', 'withholdingTaxAccountId'],
};
