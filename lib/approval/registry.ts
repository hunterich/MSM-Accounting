import type { ApprovalDocumentType, ModuleKey } from '@prisma/client';
import type { ApprovalModuleKey } from './config';

export interface ApprovalDescriptor {
  documentType: ApprovalDocumentType;
  configKey: ApprovalModuleKey;
  moduleKey: ModuleKey;
}

// Phase 1 covers INVOICE + PURCHASE_ORDER. Phase 2/3 add entries here.
export const APPROVAL_REGISTRY: Partial<Record<ApprovalDocumentType, ApprovalDescriptor>> = {
  INVOICE: { documentType: 'INVOICE', configKey: 'ar_invoices', moduleKey: 'AR_INVOICES' },
  PURCHASE_ORDER: { documentType: 'PURCHASE_ORDER', configKey: 'ap_pos', moduleKey: 'AP_POS' },
};

export function getDescriptor(documentType: ApprovalDocumentType): ApprovalDescriptor {
  const d = APPROVAL_REGISTRY[documentType];
  if (!d) throw new Error(`No approval descriptor for documentType ${documentType}`);
  return d;
}
