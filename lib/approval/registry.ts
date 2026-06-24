import type { ApprovalDocumentType, ModuleKey } from '@prisma/client';
import type { ApprovalModuleKey } from './config';

export interface ApprovalDescriptor {
  documentType: ApprovalDocumentType;
  configKey: ApprovalModuleKey;
  moduleKey: ModuleKey;
}

// Phase 1 covers INVOICE + PURCHASE_ORDER. Phase 2 adds the remaining 7 doc types.
export const APPROVAL_REGISTRY: Partial<Record<ApprovalDocumentType, ApprovalDescriptor>> = {
  INVOICE:         { documentType: 'INVOICE',         configKey: 'ar_invoices',    moduleKey: 'AR_INVOICES' },
  PURCHASE_ORDER:  { documentType: 'PURCHASE_ORDER',  configKey: 'ap_pos',         moduleKey: 'AP_POS' },
  BILL:            { documentType: 'BILL',            configKey: 'ap_bills',       moduleKey: 'AP_BILLS' },
  SALES_ORDER:     { documentType: 'SALES_ORDER',     configKey: 'ar_sales_orders', moduleKey: 'AR_SALES_ORDERS' },
  PAYROLL_RUN:     { documentType: 'PAYROLL_RUN',     configKey: 'hr_payroll',     moduleKey: 'HR_PAYROLL' },
  CREDIT_NOTE:     { documentType: 'CREDIT_NOTE',     configKey: 'ar_credits',     moduleKey: 'AR_CREDITS' },
  DEBIT_NOTE:      { documentType: 'DEBIT_NOTE',      configKey: 'ap_debits',      moduleKey: 'AP_DEBITS' },
  SALES_RETURN:    { documentType: 'SALES_RETURN',    configKey: 'ar_credits',     moduleKey: 'AR_CREDITS' },
  PURCHASE_RETURN: { documentType: 'PURCHASE_RETURN', configKey: 'ap_debits',      moduleKey: 'AP_DEBITS' },
  AR_PAYMENT:       { documentType: 'AR_PAYMENT',       configKey: 'ar_payments', moduleKey: 'AR_PAYMENTS' },
  AP_PAYMENT:       { documentType: 'AP_PAYMENT',       configKey: 'ap_payments', moduleKey: 'AP_PAYMENTS' },
  STOCK_ADJUSTMENT: { documentType: 'STOCK_ADJUSTMENT', configKey: 'inv_adj',     moduleKey: 'INV_ADJ' },
};

export function getDescriptor(documentType: ApprovalDocumentType): ApprovalDescriptor {
  const d = APPROVAL_REGISTRY[documentType];
  if (!d) throw new Error(`No approval descriptor for documentType ${documentType}`);
  return d;
}
