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
import { getBatch } from './batch-service';

export interface RollbackResult {
  rolledBack: boolean;
  reason?: string;
}

export async function rollbackBatch(orgId: string, batchId: string): Promise<RollbackResult> {
  const batch = await getBatch(orgId, batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'COMMITTED') {
    throw new Error('Only a committed batch can be rolled back');
  }

  // Post-cutover activity guard. `{ not: batchId }` on a nullable column does not
  // reliably include NULLs across engines, and manual/foreign entries carry a
  // NULL migrationBatchId — so match both explicitly to be sure they are caught.
  const foreignActivity = await prisma.journalEntry.count({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      date: { gte: batch.cutoverDate },
      OR: [{ migrationBatchId: null }, { migrationBatchId: { not: batchId } }],
    },
  });
  if (foreignActivity > 0) {
    return {
      rolledBack: false,
      reason: 'Transactions were already posted after the cutover date; rollback is blocked.',
    };
  }

  await prisma.$transaction(async (tx) => {
    const where = { organizationId: orgId, migrationBatchId: batchId };
    // Reverse dependency order. Inventory rows first (Item FK is Restrict), then
    // the transactional documents (their line children cascade), then the
    // journal (its lines cascade; Account FK is Restrict so this precedes
    // account deletes), then the master data.
    await tx.inventoryLedgerEntry.deleteMany({ where });
    await tx.inventoryLot.deleteMany({ where });
    await tx.salesInvoice.deleteMany({ where });
    await tx.bill.deleteMany({ where });
    await tx.journalEntry.deleteMany({ where });
    await tx.item.deleteMany({ where });
    await tx.customer.deleteMany({ where });
    await tx.vendor.deleteMany({ where });
    await tx.account.deleteMany({ where });
    await tx.migrationBatch.update({
      where: { id: batchId },
      data: { status: 'ROLLED_BACK' },
    });
  });

  return { rolledBack: true };
}
