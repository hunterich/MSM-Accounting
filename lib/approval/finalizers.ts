import type { ApprovalDocumentType, Prisma } from '@prisma/client';
import { postInvoiceSend } from '@/lib/invoice-send-posting';

export type Finalizer = (tx: Prisma.TransactionClient, orgId: string, documentId: string) => Promise<void>;

export const FINALIZERS: Partial<Record<ApprovalDocumentType, Finalizer>> = {
  INVOICE: async (tx, orgId, documentId) => {
    await postInvoiceSend(tx, orgId, documentId);
    await tx.salesInvoice.update({ where: { id: documentId }, data: { status: 'SENT', updatedAt: new Date() } });
  },
  PURCHASE_ORDER: async (tx, _orgId, documentId) => {
    // POs post no GL at approval; going live = APPROVED status.
    await tx.purchaseOrder.update({ where: { id: documentId }, data: { status: 'APPROVED', updatedAt: new Date() } });
  },
};

export function getFinalizer(documentType: ApprovalDocumentType): Finalizer {
  const fn = FINALIZERS[documentType];
  if (!fn) throw new Error(`No finalizer for documentType ${documentType}`);
  return fn;
}
