import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

/** Hold the physical return stable until the financial note is posted or queued.
 * Call after the note lock and before source-document or journal locks.
 * Draft notes deliberately do not reserve a return.
 */
export async function lockEligibleNoteReturn(
  tx: Prisma.TransactionClient,
  kind: 'credit' | 'debit',
  note: { organizationId: string; partyId: string; sourceId: string | null; returnId: string | null },
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
}
