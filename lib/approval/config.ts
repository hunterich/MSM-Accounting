export const APPROVAL_MODULE_KEYS = [
  'ar_sales_orders',
  'ar_invoices',
  'ar_payments',
  'ar_credits',
  'ap_pos',
  'ap_bills',
  'ap_payments',
  'ap_debits',
  'inv_adj',
  'hr_payroll',
] as const;

export type ApprovalModuleKey = (typeof APPROVAL_MODULE_KEYS)[number];
export type ApprovalRequirements = Record<ApprovalModuleKey, boolean>;

export const DEFAULT_APPROVAL_REQUIREMENTS: ApprovalRequirements =
  APPROVAL_MODULE_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as ApprovalRequirements);

export function normalizeApprovalRequirements(raw: unknown): ApprovalRequirements {
  const out: ApprovalRequirements = { ...DEFAULT_APPROVAL_REQUIREMENTS };
  if (raw && typeof raw === 'object') {
    for (const key of APPROVAL_MODULE_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

export function requiresApproval(
  reqs: ApprovalRequirements | null | undefined,
  key: ApprovalModuleKey,
): boolean {
  return reqs?.[key] === true;
}
