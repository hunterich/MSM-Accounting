export type SettlementFeeKey =
  | 'commissionFee' | 'serviceFee' | 'orderProcessingFee' | 'transactionFee' | 'campaignFee'
  | 'sellerPromotion' | 'refund' | 'buyerShipping' | 'actualShipping' | 'shippingRebate'
  | 'sellerVoucher' | 'platformRebate' | 'coinCashback' | 'customTax' | 'growthXtraFee' | 'freeShippingXtraFee' | 'otherPlatformFee';

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
  commissionfeeincludingppn10: 'commissionFee', biayapembayaran: 'transactionFee',
  shippingfeechargedbylogisticprovider: 'actualShipping', reverseshippingfee: 'actualShipping', returntosellerfee: 'actualShipping',
  shippingrebatefromlogisticprovider: 'shippingRebate',
  biayagratisongkirxtraukuranbiasakategorid: 'freeShippingXtraFee',
  biayagratisongkirxtraukuranbiasakategorig: 'freeShippingXtraFee',
  otherfee: 'otherPlatformFee', wht22: 'customTax',
  cofundvouchersponsoredbyseller: 'sellerVoucher', cofundcoincashbacksponsoredbyseller: 'coinCashback',
};

// Real TikTok income_ file: normalized Indonesian column → canonical key.
// Unrepresented fees leave a payout difference for review.
export const TIKTOK_COLUMN_TO_KEY: Record<string, SettlementFeeKey> = {
  biayakomisiplatform: 'commissionFee',
  biayakomisisebelumdiskon: 'commissionFee',
  komisiafiliasi: 'serviceFee',
  komisimitraafiliasi: 'serviceFee',
  biayapembayaran: 'transactionFee',
  biayapemrosesanpesanan: 'orderProcessingFee',
  diskonpenjual: 'sellerPromotion',
  // Net product refund after the seller discount; the before-discount and
  // discount-refund columns are components of this value, not extra refunds.
  totalpengembaliandanasetelahdiskon: 'refund',
  biayalayananprogramgrowthxtra: 'growthXtraFee',
  biayalayananlogistik: 'actualShipping',
  ongkir: 'actualShipping',
  pphpasal22dipungut: 'customTax',
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
  growthXtraFee: ['fees', 'growthXtraAccountId'],
  freeShippingXtraFee: ['fees', 'freeShippingXtraAccountId'], otherPlatformFee: ['fees', 'otherPlatformFeeAccountId'],
};
