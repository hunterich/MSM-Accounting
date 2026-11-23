import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { linkedReturnBasis } from './note-return-value';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';

/** Hold the physical return stable until the financial note is posted or queued.
 * Call after the note lock and before source-document or journal locks.
 * Draft notes deliberately do not reserve a return.
 */
export async function lockEligibleNoteReturn(
  tx: Prisma.TransactionClient,
  kind: 'credit' | 'debit',
  note: { id: string; amount: Prisma.Decimal.Value; taxAmount?: Prisma.Decimal.Value; organizationId: string; partyId: string; sourceId: string | null; returnId: string | null },
): Promise<void> {
  if (!note.returnId) return;
  const { organizationId, returnId } = note;
  if (kind === 'credit') {
    await tx.$queryRaw`SELECT "id" FROM "SalesReturn" WHERE "id" = ${returnId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseReturn" WHERE "id" = ${returnId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  }
  // Read after waiting: status and source may have changed under the row lock.
  const ret = kind === 'credit'
    ? await tx.salesReturn.findFirst({ where: { id: returnId, organizationId }, select: { status: true, customerId: true, invoiceId: true } })
    : await tx.purchaseReturn.findFirst({ where: { id: returnId, organizationId }, select: { status: true, vendorId: true, billId: true } });
  const label = kind === 'credit' ? 'sales return' : 'purchase return';
  if (!ret) throw new ApiError(`Linked ${label} not found in organization`, 422);
  if (ret.status === 'DRAFT' || ret.status === 'VOID') {
    throw new ApiError(`Cannot apply or submit this note: linked ${label} is ${ret.status.toLowerCase()}`, 422);
  }
  const partyId = 'customerId' in ret ? ret.customerId : ret.vendorId;
  const sourceId = 'invoiceId' in ret ? ret.invoiceId : ret.billId;
  if (partyId !== note.partyId || sourceId !== note.sourceId) {
    throw new ApiError(`Note party and source document must match the linked ${label}`, 422);
  }

  const { total: value, tax } = await linkedReturnBasis(tx, kind, organizationId, returnId);
  const otherNotes = kind === 'credit'
    ? await tx.creditNote.aggregate({ where: { organizationId, salesReturnId: returnId,
      id: { not: note.id }, status: { in: ['APPLIED', 'PENDING_APPROVAL'] } }, _sum: { amount: true, taxAmount: true } })
    : await tx.debitNote.aggregate({ where: { organizationId, purchaseReturnId: returnId,
      id: { not: note.id }, status: { in: ['APPLIED', 'PENDING_APPROVAL'] } }, _sum: { amount: true, taxAmount: true } });
  const used = new MoneyDecimal(otherNotes._sum.amount ?? 0);
  const amount = roundMoneyDecimal(note.amount);
  if (!amount.isFinite() || amount.lte(0)) throw new ApiError('Note amount must be greater than zero', 422);
  if (used.plus(amount).gt(value)) {
    const available = MoneyDecimal.max(0, value.minus(used));
    throw new ApiError(`Linked ${label} limit exceeded: return value ${value.toFixed(2)}, applied or reserved ${used.toFixed(2)}, available ${available.toFixed(2)}. Use a standalone note for goodwill or price concessions.`, 422);
  }
  if (tax != null) {
    const noteTax = roundMoneyDecimal(note.taxAmount ?? 0);
    const usedTax = new MoneyDecimal(otherNotes._sum.taxAmount ?? 0);
    if (noteTax.lt(0) || noteTax.gt(amount) || usedTax.plus(noteTax).gt(tax) ||
        used.minus(usedTax).plus(amount.minus(noteTax)).gt(value.minus(tax))) {
      throw new ApiError(`The ${kind} note net amount or PPN exceeds the available amount on the linked ${label}.`, 422);
    }
  }
}
