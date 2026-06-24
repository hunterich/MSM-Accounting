import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { reverseAddedLayers, restoreConsumedLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

/**
 * Void a posted stock adjustment: reverse its variance journal entry and unwind
 * the inventory it moved, then mark VOID. Period-guarded; VOID is terminal.
 *
 * An adjustment can move stock both ways across its lines (increases via
 * addCostLayer, decreases via relieveCostLayers — all tagged ADJUSTMENT + id), so
 * the void:
 *   1. removes the increase layers (`reverseAddedLayers`, blocks if since consumed),
 *   2. THEN restores the decrease draw-downs (`restoreConsumedLayers`).
 * The order matters: restoring adds fresh ADJUSTMENT-tagged layers, so it must run
 * after the removal — otherwise the removal would delete the just-restored layers.
 *
 * The variance JE is resolved by its deterministic memo (`Stock adjustment:
 * <number>` — no journalEntryId column); a net-zero adjustment posted no JE, so
 * that step is skipped. Reversing the JE restores the inventory asset in the GL;
 * the inventory primitives restore the perpetual subledger by the same amount.
 */
export async function voidStockAdjustment(
  tx: Tx,
  orgId: string,
  id: string,
  opts: { date: Date },
): Promise<void> {
  const adj = await tx.stockAdjustment.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, number: true, status: true },
  });

  if (!adj) {
    throw new ApiError('Stock adjustment not found', 404);
  }
  if (adj.status === 'VOID') {
    throw new ApiError('Stock adjustment is already voided', 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);

  const entry = await tx.journalEntry.findFirst({
    where: { organizationId: orgId, status: 'POSTED', memo: `Stock adjustment: ${adj.number}` },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(tx, entry.id, { date: opts.date, memo: `Void stock adjustment: ${adj.number}` });
  }

  // Remove the increase layers first, then restore the decrease draw-downs.
  await reverseAddedLayers(tx, orgId, InventoryDocumentType.ADJUSTMENT, id, opts.date);
  await restoreConsumedLayers(tx, orgId, InventoryDocumentType.ADJUSTMENT, id, opts.date);

  await tx.stockAdjustment.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } });
}
