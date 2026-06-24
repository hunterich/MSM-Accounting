import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { reverseAddedLayers, restoreConsumedLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

interface ReturnRow {
  id: string;
  number: string;
  status: string;
  journalEntryId: string | null;
  appliedNotes: { id: string }[];
}

interface VoidConfig {
  label: string;
  noteLabel: string;
  find: (tx: Tx, orgId: string, id: string) => Promise<ReturnRow | null>;
  unwindInventory: (tx: Tx, orgId: string, id: string, date: Date) => Promise<number>;
  markVoid: (tx: Tx, orgId: string, id: string) => Promise<unknown>;
}

/**
 * Shared void core for returns: reverse the inventory posting entry, unwind the
 * stock the return moved, and mark VOID. Period-guarded; VOID is terminal.
 *
 * The financial leg lives on the linked credit/debit note (voided separately).
 * Because a purchase return shares the apReturn clearing account with its debit
 * note, voiding a return that already has an APPLIED note would unbalance it —
 * so that is blocked (applied to both return types for symmetry).
 *
 * Draft returns are not posted (delete instead). A services-only return has no
 * journalEntryId — skip the JE reversal but still unwind (a no-op) and mark VOID.
 */
async function voidReturn(
  tx: Tx,
  orgId: string,
  id: string,
  opts: { date: Date },
  cfg: VoidConfig,
): Promise<void> {
  const ret = await cfg.find(tx, orgId, id);
  if (!ret) {
    throw new ApiError(`${cfg.label} not found`, 404);
  }
  if (ret.status === 'VOID') {
    throw new ApiError(`${cfg.label} is already voided`, 422);
  }
  if (ret.status === 'DRAFT') {
    throw new ApiError(`Draft ${cfg.label}s are not posted — delete instead of voiding`, 422);
  }
  if (ret.appliedNotes.length > 0) {
    throw new ApiError(`Cannot void this ${cfg.label} — void the linked ${cfg.noteLabel} first`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);
  if (ret.journalEntryId) {
    await reverseJournalEntry(tx, ret.journalEntryId, { date: opts.date, memo: `Void ${cfg.label}: ${ret.number}` });
  }
  await cfg.unwindInventory(tx, orgId, id, opts.date);
  await cfg.markVoid(tx, orgId, id);
}

const SR_CONFIG: VoidConfig = {
  label: 'sales return',
  noteLabel: 'credit note',
  find: async (tx, orgId, id) => {
    const r = await tx.salesReturn.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        number: true,
        status: true,
        journalEntryId: true,
        creditNotes: { where: { status: 'APPLIED' }, select: { id: true } },
      },
    });
    return r ? { id: r.id, number: r.number, status: r.status, journalEntryId: r.journalEntryId, appliedNotes: r.creditNotes } : null;
  },
  unwindInventory: (tx, orgId, id, date) => reverseAddedLayers(tx, orgId, InventoryDocumentType.SALES_RETURN, id, date),
  markVoid: (tx, orgId, id) => tx.salesReturn.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

const PR_CONFIG: VoidConfig = {
  label: 'purchase return',
  noteLabel: 'debit note',
  find: async (tx, orgId, id) => {
    const r = await tx.purchaseReturn.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        number: true,
        status: true,
        journalEntryId: true,
        debitNotes: { where: { status: 'APPLIED' }, select: { id: true } },
      },
    });
    return r ? { id: r.id, number: r.number, status: r.status, journalEntryId: r.journalEntryId, appliedNotes: r.debitNotes } : null;
  },
  unwindInventory: (tx, orgId, id, date) => restoreConsumedLayers(tx, orgId, InventoryDocumentType.PURCHASE_RETURN, id, date),
  markVoid: (tx, orgId, id) => tx.purchaseReturn.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

export function voidSalesReturn(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidReturn(tx, orgId, id, opts, SR_CONFIG);
}

export function voidPurchaseReturn(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidReturn(tx, orgId, id, opts, PR_CONFIG);
}
