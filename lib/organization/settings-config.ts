// Canonical backend defaults + normalizers for the org-settings JSON columns.
// Mirrors lib/approval/config.ts. Shapes match src/stores/useSettingsStore.ts
// (the codebase intentionally keeps a small copy per layer, like the approval
// defaults).

export const FEATURE_KEYS = [
  'salesOrders', 'salesReturns', 'recurringInvoices', 'subscriptions',
  'recurringExpenses', 'deliveryNotes', 'customerCategories', 'approvals',
  'shopIntegrations', 'purchaseOrders', 'vendorCategories', 'itemCategories',
  'fixedAssets', 'hrPayroll',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

export const DEFAULT_FEATURES: Features = FEATURE_KEYS.reduce(
  (acc, k) => { acc[k] = true; return acc; }, {} as Features,
);

export function normalizeFeatures(raw: unknown): Features {
  const out: Features = { ...DEFAULT_FEATURES };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of FEATURE_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

export interface SalesPolicy { blockSellBelowCost: boolean; requireSalesOrder: boolean; }
export const DEFAULT_SALES_POLICY: SalesPolicy = { blockSellBelowCost: false, requireSalesOrder: false };

export function normalizeSalesPolicy(raw: unknown): SalesPolicy {
  const out: SalesPolicy = { ...DEFAULT_SALES_POLICY };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.blockSellBelowCost === 'boolean') out.blockSellBelowCost = o.blockSellBelowCost;
    if (typeof o.requireSalesOrder === 'boolean') out.requireSalesOrder = o.requireSalesOrder;
  }
  return out;
}

export interface DocNumberingConfig { prefix: string; resetPeriod: string; seqLength: number; }
export const DOC_NUMBERING_KEYS = ['ar_invoice', 'ap_bill', 'so_order', 'po_order', 'ar_payment', 'ap_payment'] as const;
export type DocNumberingKey = (typeof DOC_NUMBERING_KEYS)[number];

export const DEFAULT_DOCUMENT_NUMBERING: Record<DocNumberingKey, DocNumberingConfig> = {
  ar_invoice: { prefix: 'INV',  resetPeriod: 'monthly', seqLength: 6 },
  ap_bill:    { prefix: 'BILL', resetPeriod: 'monthly', seqLength: 6 },
  so_order:   { prefix: 'SO',   resetPeriod: 'monthly', seqLength: 6 },
  po_order:   { prefix: 'PO',   resetPeriod: 'monthly', seqLength: 6 },
  ar_payment: { prefix: 'PAY',  resetPeriod: 'never',   seqLength: 6 },
  ap_payment: { prefix: 'VPAY', resetPeriod: 'never',   seqLength: 6 },
};

const RESET_PERIODS = new Set(['monthly', 'yearly', 'never']);
const SEQ_LENGTHS = new Set([4, 5, 6, 8]);

export function normalizeDocumentNumbering(raw: unknown): Record<DocNumberingKey, DocNumberingConfig> {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<DocNumberingKey, DocNumberingConfig>;
  for (const key of DOC_NUMBERING_KEYS) {
    const def = DEFAULT_DOCUMENT_NUMBERING[key];
    const incoming = (src[key] && typeof src[key] === 'object') ? (src[key] as Record<string, unknown>) : {};
    out[key] = {
      prefix: typeof incoming.prefix === 'string' && incoming.prefix.length > 0
        ? incoming.prefix.toUpperCase() : def.prefix,
      resetPeriod: RESET_PERIODS.has(String(incoming.resetPeriod)) ? String(incoming.resetPeriod) : def.resetPeriod,
      seqLength: SEQ_LENGTHS.has(Number(incoming.seqLength)) ? Number(incoming.seqLength) : def.seqLength,
    };
  }
  return out;
}
