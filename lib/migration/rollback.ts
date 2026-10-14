/**
 * Migration rollback service.
 *
 * A committed migration stamps every record it created with `migrationBatchId`.
 * Rollback deletes all records carrying that stamp — in reverse dependency order
 * so foreign-key constraints never block — and marks the batch `ROLLED_BACK`.
 *
 * Rollback is BLOCKED once the books are in use: if any POSTED JournalEntry that
 * does NOT belong to this batch is dated on/after the batch's cutover date, real
 * activity has been posted on top of the opening balances and unwinding the
 * opening balances would corrupt the live ledger.
 *
 * Delete order verified against schema.prisma:
 *   - JournalLine → JournalEntry, SalesInvoiceLine → SalesInvoice,
 *     BillLine → Bill are all `onDelete: Cascade`, so deleting the parent
 *     removes the lines; no explicit line delete is needed.
 *   - InventoryLedgerEntry → Item and InventoryLot → Item are `Restrict`, so
 *     the inventory rows must be deleted before the items.
 *   - JournalLine → Account is `Restrict`, so journal entries (and their lines)
 *     must be deleted before accounts.
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { ApiError } from '../errors';

export interface RollbackResult {
  rolledBack: boolean;
  reason?: string;
}

export async function rollbackBatch(orgId: string, batchId: string): Promise<RollbackResult> {
  // A concurrent stock/journal change may invalidate the snapshot. Retry the
  // entire transaction so the next guard sees committed activity, never a
  // half-deleted migration. No company/item lock is taken after document locks.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(tx => rollbackBatchInTransaction(tx, orgId, batchId), { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2003'].includes(error.code)) throw error;
    }
  }
  return { rolledBack: false, reason: 'Dependent or concurrent activity prevented rollback; no migration data was removed. Review activity before retrying.' };
}

/** Transaction primitive used by the serializable service and overlap tests. */
export async function rollbackBatchInTransaction(tx: Prisma.TransactionClient, orgId: string, batchId: string): Promise<RollbackResult> {
  const isolation = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`;
  if (isolation[0]?.transaction_isolation !== 'serializable') throw new Error('Migration rollback requires a serializable transaction');
  await tx.$queryRaw`SELECT "id" FROM "MigrationBatch" WHERE "id" = ${batchId} AND "organizationId" = ${orgId} FOR UPDATE`;
  const batch = await tx.migrationBatch.findFirst({ where: { id: batchId, organizationId: orgId } });
  if (!batch) throw new ApiError('Batch not found', 404);
  if (batch.status !== 'COMMITTED') {
    throw new ApiError('Only a committed batch can be rolled back', 409);
  }

  // Post-cutover activity guard. `{ not: batchId }` on a nullable column does not
  // reliably include NULLs across engines, and manual/foreign entries carry a
  // NULL migrationBatchId — so match both explicitly to be sure they are caught.
  const foreignActivity = await tx.journalEntry.count({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      date: { gte: batch.cutoverDate },
      OR: [{ migrationBatchId: null }, { migrationBatchId: { not: batchId } }],
    },
  });
  // Zero-cost receipts/adjustments still change stock even without a journal.
  const foreignStock = await tx.inventoryLedgerEntry.count({ where: { organizationId: orgId,
    date: { gte: batch.cutoverDate }, OR: [{ migrationBatchId: null }, { migrationBatchId: { not: batchId } }],
  } });
  if (foreignActivity > 0 || foreignStock > 0) {
    return {
      rolledBack: false,
      reason: 'Financial or stock transactions were already posted after the cutover date; rollback is blocked.',
    };
  }

  const where = { organizationId: orgId, migrationBatchId: batchId };
  // Reverse dependency order; every delete stays within this locked batch.
  await tx.inventoryLedgerEntry.deleteMany({ where });
  await tx.inventoryLot.deleteMany({ where });
  await tx.salesInvoice.deleteMany({ where });
  await tx.bill.deleteMany({ where });
  await tx.journalEntry.deleteMany({ where });
  await tx.item.deleteMany({ where });
  await tx.customer.deleteMany({ where });
  await tx.vendor.deleteMany({ where });
  await tx.account.deleteMany({ where });
  await tx.migrationBatch.update({ where: { id: batchId }, data: { status: 'ROLLED_BACK' } });
  return { rolledBack: true };
}
