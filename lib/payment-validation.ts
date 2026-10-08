import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

type Tx = Prisma.TransactionClient;
export type PaymentKind = 'ar' | 'ap';
type Allocation = { invoiceId?: string; billId?: string; amountApplied: unknown; discountAmount?: unknown; penaltyAmount?: unknown };

const cents = (value: unknown) => {
  const number = Number(value ?? 0);
  const result = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(result)) {
    throw new ApiError('Payment amounts must be finite, non-negative currency values', 422);
  }
  return result;
};

/** Serialize posting, edits and deletion of the same payment. */
export async function lockPayment(tx: Tx, orgId: string, kind: PaymentKind, id: string) {
  if (kind === 'ar') await tx.$queryRaw`SELECT "id" FROM "ARPayment" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "APPayment" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
}

/** Only drafts may change financially. Status-only completion retries remain safe. */
export function assertPaymentEditable(existing: { status: string; journalEntryId: string | null }, changes: Record<string, unknown>) {
  if (existing.status === 'DRAFT' && !existing.journalEntryId) return;
  const keys = Object.keys(changes).filter(key => changes[key] !== undefined);
  if (existing.status === 'PROCESSING' && !existing.journalEntryId && keys.length === 1 && changes.status === 'COMPLETED') return;
  if (keys.length === 0 || (keys.length === 1 && keys[0] === 'status' && changes.status === existing.status)) return;
  throw new ApiError('Only draft payments can be edited. Posted payments must be voided and recreated; pending payments must finish approval first.', 409);
}

/** Validate against current balances under ordered document locks, also at approval. */
export async function validatePaymentAllocations(tx: Tx, orgId: string, kind: PaymentKind, payment: {
  id?: string; customerId?: string; vendorId?: string; totalAmount: unknown; allocations?: Allocation[];
}, options: { excludeNoteId?: string } = {}) {
  const total = cents(payment.totalAmount);
  const allocations = payment.allocations ?? [];
  const ids = allocations.map(a => kind === 'ar' ? a.invoiceId : a.billId);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new ApiError('Payment allocations must reference distinct documents', 422);
  }
  const allocatedCash = allocations.reduce((sum, a) => sum + cents(a.amountApplied) + cents(a.penaltyAmount), 0);
  // Excess cash remains an unallocated advance; it is not document settlement.
  if (allocatedCash > total) throw new ApiError('Allocated cash and fees exceed the payment total', 422);

  for (const a of [...allocations].sort((left, right) => String(left.invoiceId ?? left.billId).localeCompare(String(right.invoiceId ?? right.billId)))) {
    const id = (kind === 'ar' ? a.invoiceId : a.billId)!;
    const cleared = cents(a.amountApplied) + cents(a.discountAmount);
    if (cleared <= 0) throw new ApiError('Each allocation must settle a positive amount', 422);
    if (kind === 'ar') await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "Bill" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
    const doc = kind === 'ar'
      ? await tx.salesInvoice.findFirst({ where: { id, organizationId: orgId }, select: { totalAmount: true, status: true, customerId: true } })
      : await tx.bill.findFirst({ where: { id, organizationId: orgId }, select: { totalAmount: true, status: true, vendorId: true } });
    if (!doc) throw new ApiError('Allocated document not found in organization', 404);
    const party = 'customerId' in doc ? doc.customerId : doc.vendorId;
    if (party !== (kind === 'ar' ? payment.customerId : payment.vendorId)) throw new ApiError('Allocated document belongs to another customer or vendor', 422);
    if (['DRAFT', 'VOID', 'PENDING_APPROVAL'].includes(doc.status)) throw new ApiError(`Cannot apply a payment to a ${doc.status} document`, 422);
    const filter = { payment: { organizationId: orgId, status: 'COMPLETED' as const }, ...(payment.id ? { paymentId: { not: payment.id } } : {}) };
    const paid = kind === 'ar'
      ? await tx.aRPaymentAllocation.aggregate({ where: { ...filter, invoiceId: id }, _sum: { amountApplied: true, discountAmount: true } })
      : await tx.aPPaymentAllocation.aggregate({ where: { ...filter, billId: id }, _sum: { amountApplied: true, discountAmount: true } });
    const notes = kind === 'ar'
      ? await tx.creditNote.findMany({ where: { organizationId: orgId, sourceInvoiceId: id, status: 'APPLIED', settlementType: 'APPLY_TO_INVOICE', ...(options.excludeNoteId ? { id: { not: options.excludeNoteId } } : {}) }, select: { amount: true } })
      : await tx.debitNote.findMany({ where: { organizationId: orgId, sourceBillId: id, status: 'APPLIED', settlementType: 'APPLY_TO_BILL', ...(options.excludeNoteId ? { id: { not: options.excludeNoteId } } : {}) }, select: { amount: true } });
    // Note.amount is gross (its taxAmount is already included).
    const outstanding = cents(doc.totalAmount) - cents(paid._sum.amountApplied) - cents(paid._sum.discountAmount) - notes.reduce((sum, note) => sum + cents(note.amount), 0);
    if (cleared > outstanding) throw new ApiError(`Over-allocation: remaining balance is ${(Math.max(0, outstanding) / 100).toFixed(2)}`, 422);
  }
}
