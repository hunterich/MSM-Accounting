import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { reverseAdjustmentInventory } from './inventory-costing';

type Tx = Prisma.TransactionClient;

/**
 * Void a posted stock adjustment: reverse its variance journal entry and unwind
 * the inventory it moved, then mark VOID. Period-guarded; VOID is terminal.
 *
 * An adjustment can move stock both ways across its lines (increases via
 * addCostLayer, decreases via relieveCostLayers — all tagged ADJUSTMENT + id), so
 * the inventory unwind goes through `reverseAdjustmentInventory`, a single
 * snapshot-first pass that removes the increase layers (blocking if since
 * consumed) and restores the decrease draw-downs without the two directions'
 * reversal rows colliding.
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

  // Atomically claim VOID before any GL/inventory side effect. The guarded
  // `updateMany` takes a row lock; a concurrent void blocks here, then sees the
  // adjustment already VOID → count 0 → 409, so the reversal + inventory unwind
  // run exactly once and can never be double-reversed.
  const claim = await tx.stockAdjustment.updateMany({
    where: { id, organizationId: orgId, status: { not: 'VOID' } },
    data: { status: 'VOID' },
  });
  if (claim.count !== 1) {
    throw new ApiError('Stock adjustment is already voided', 409);
  }

  const entry = await tx.journalEntry.findFirst({
    where: { organizationId: orgId, status: 'POSTED', memo: `Stock adjustment: ${adj.number}` },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(tx, entry.id, { date: opts.date, memo: `Void stock adjustment: ${adj.number}` });
  }

  // Unwind both directions in one snapshot-first pass (removes increases,
  // restores decreases) — avoids the two generic primitives colliding on the
  // shared ADJUSTMENT documentId.
  await reverseAdjustmentInventory(tx, orgId, id, opts.date);
}
