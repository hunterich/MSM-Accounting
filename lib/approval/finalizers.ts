import type { ApprovalDocumentType, Prisma } from '@prisma/client';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { assertPeriodOpen } from '@/lib/period-guard';
import { postBillToLedger } from '@/lib/bill-posting';
import { applyBillPoReceipt } from '@/lib/bill-po-receipt';
import { postPayrollRunToLedger } from '@/lib/payroll-posting';
import { postCreditNoteOnApply } from '@/lib/credit-note-posting';
import { postDebitNoteOnApply } from '@/lib/debit-note-posting';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '@/lib/payment-posting';
import { postStockAdjustmentIfNeeded } from '@/lib/stock-adjustment-posting';
import { ApiError } from '@/lib/errors';

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
  BILL: async (tx, orgId, documentId) => {
    const bill = await tx.bill.findFirst({ where: { id: documentId, organizationId: orgId }, include: { lines: true } });
    if (!bill) throw new ApiError('Bill not found', 404);
    await assertPeriodOpen(tx, orgId, bill.issueDate ? new Date(bill.issueDate) : new Date());
    // Apply the PO receipt FIRST (before postBillToLedger books the inventory
    // lots applyBillPoReceipt uses to detect an already-booked goods receipt).
    // This is the held -> approved finalize: the receipt deferred at create time
    // now lands, exactly once.
    await applyBillPoReceipt(tx, orgId, documentId);
    await postBillToLedger(tx, orgId, bill as never);
    await tx.bill.update({ where: { id: documentId }, data: { status: 'OPEN', updatedAt: new Date() } });
  },
  SALES_ORDER: async (tx, _orgId, documentId) => {
    // Sales orders post no GL; going live = CONFIRMED status.
    await tx.salesOrder.update({ where: { id: documentId }, data: { status: 'CONFIRMED', updatedAt: new Date() } });
  },
  PAYROLL_RUN: async (tx, orgId, documentId) => {
    await postPayrollRunToLedger(tx, orgId, documentId);
    await tx.payrollRun.update({ where: { id: documentId }, data: { status: 'POSTED', updatedAt: new Date() } });
  },
  CREDIT_NOTE: async (tx, _orgId, documentId) => {
    await postCreditNoteOnApply(tx, documentId);
    await tx.creditNote.update({ where: { id: documentId }, data: { status: 'APPLIED', updatedAt: new Date() } });
  },
  DEBIT_NOTE: async (tx, _orgId, documentId) => {
    await postDebitNoteOnApply(tx, documentId);
    await tx.debitNote.update({ where: { id: documentId }, data: { status: 'APPLIED', updatedAt: new Date() } });
  },
  SALES_RETURN: async (tx, _orgId, documentId) => {
    await postSalesReturnOnApproval(tx, documentId);
    await tx.salesReturn.update({ where: { id: documentId }, data: { status: 'APPROVED', updatedAt: new Date() } });
  },
  PURCHASE_RETURN: async (tx, _orgId, documentId) => {
    await postPurchaseReturnOnApproval(tx, documentId);
    await tx.purchaseReturn.update({ where: { id: documentId }, data: { status: 'APPROVED', updatedAt: new Date() } });
  },
  AR_PAYMENT: async (tx, orgId, documentId) => {
    // Set the live status FIRST — postArPaymentIfNeeded skips while PENDING_APPROVAL.
    await tx.aRPayment.update({ where: { id: documentId }, data: { status: 'COMPLETED', updatedAt: new Date() } });
    await postArPaymentIfNeeded(tx, orgId, documentId);
  },
  AP_PAYMENT: async (tx, orgId, documentId) => {
    await tx.aPPayment.update({ where: { id: documentId }, data: { status: 'COMPLETED', updatedAt: new Date() } });
    await postApPaymentIfNeeded(tx, orgId, documentId);
  },
  STOCK_ADJUSTMENT: async (tx, orgId, documentId) => {
    // Post while still PENDING_APPROVAL (wrapper skips only when APPROVED), then mark APPROVED.
    await postStockAdjustmentIfNeeded(tx, orgId, documentId);
    await tx.stockAdjustment.update({ where: { id: documentId }, data: { status: 'APPROVED', updatedAt: new Date() } });
  },
};

export function getFinalizer(documentType: ApprovalDocumentType): Finalizer {
  const fn = FINALIZERS[documentType];
  if (!fn) throw new Error(`No finalizer for documentType ${documentType}`);
  return fn;
}
