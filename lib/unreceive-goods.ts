import { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { toNumber } from './money';
import { assertPeriodOpen } from './period-guard';
import { reversePurchaseLayers } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { advisoryLockKey } from './advisory-lock';

type Tx = Prisma.TransactionClient;

const QTY_EPSILON = 1e-6;

/**
 * Un-receive a goods receipt: reverse everything the receive route did.
 *
 * A goods receipt is represented by the draft bill it created. This removes the
 * cost layers (blocking if stock was consumed/sold), posts the GL contra
 * (Dr GR/IR · Cr Inventory) for exactly the removed value — which equals the
 * receipt's original GR/IR credit — rolls the PO's `receivedQty` and status
 * back, and soft-deletes the receipt bill.
 *
 * Only a DRAFT goods-receipt bill can be un-received. Once finalized the GR/IR
 * has been cleared to AP; void the bill first.
 */
export async function unreceiveGoodsReceipt(
  tx: Tx,
  orgId: string,
  billId: string,
  opts: { date: Date },
): Promise<void> {
  const bill = await tx.bill.findFirst({
    where: { id: billId, organizationId: orgId },
    select: {
      id: true,
      number: true,
      status: true,
      poId: true,
      receiptPostingJournalId: true,
      deletedAt: true,
      lines: { select: { quantity: true, purchaseOrderLineId: true } },
    },
  });

  if (!bill || bill.deletedAt) {
    throw new ApiError('Bill not found', 404);
  }
  if (!bill.poId) {
    throw new ApiError('This bill is not a goods receipt — only goods receipts can be un-received', 422);
  }
  if (bill.status !== 'DRAFT') {
    throw new ApiError('Only a draft goods receipt can be un-received — void the bill first', 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);
  // Receiving and un-receiving the same PO share the receive claim. PO row
  // changes below precede item locks and journal numbering, as in receiving.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`po-receive:${bill.poId}`)})`;

  // Atomically claim the un-receive before any side effect, using the soft-delete
  // field as the claim token. The guarded `updateMany` takes a row lock; a
  // concurrent un-receive blocks here, then sees the receipt already deleted →
  // count 0 → 409. This makes the lot reversal, contra JE, and PO `receivedQty`
  // decrement below run EXACTLY once (the decrement is unconditional, so a double
  // run would corrupt the PO).
  const claim = await tx.bill.updateMany({
    where: { id: billId, organizationId: orgId, status: 'DRAFT', deletedAt: null },
    data: { deletedAt: opts.date },
  });
  if (claim.count !== 1) {
    throw new ApiError('Goods receipt already un-received', 409);
  }

  // Roll back PO quantities first. A consumed-stock failure below rolls these
  // changes and the soft-delete claim back in the same transaction.
  for (const line of [...bill.lines].sort((a, b) => (a.purchaseOrderLineId ?? '').localeCompare(b.purchaseOrderLineId ?? ''))) {
    if (!line.purchaseOrderLineId) continue;
    await tx.purchaseOrderLine.update({
      where: { id: line.purchaseOrderLineId },
      data: { receivedQty: { decrement: toNumber(line.quantity) } },
    });
  }
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId: bill.poId },
    select: { quantity: true, receivedQty: true },
  });
  const anyReceived = poLines.some((pl) => toNumber(pl.receivedQty) > QTY_EPSILON);
  await tx.purchaseOrder.update({
    where: { id: bill.poId },
    data: { status: anyReceived ? 'PARTIAL_RECEIVED' : 'APPROVED' },
  });

  // Remove the cost layers this receipt booked (throws if any was consumed).
  const valueRemoved = await reversePurchaseLayers(tx, orgId, bill.id, opts.date);

  // GL contra of the receipt: Dr GR/IR, Cr Inventory for the removed value.
  if (valueRemoved > 0) {
    if (!bill.receiptPostingJournalId) throw new ApiError('The original receipt account history is unavailable. Review the historical receipt before reversing it.', 422);
    const original = await tx.journalEntry.findFirst({ where: { id: bill.receiptPostingJournalId, organizationId: orgId, status: 'POSTED' }, select: { totalDebit: true, totalCredit: true, lines: { orderBy: { lineNo: 'asc' }, select: { accountId: true, debit: true, credit: true } } } });
    if (!original || !new Prisma.Decimal(original.totalDebit).equals(valueRemoved) || !new Prisma.Decimal(original.totalCredit).equals(valueRemoved)) throw new ApiError('The original receipt journal does not match the inventory reversal. Review it before reversing.', 422);
    const lines = [
      ...original.lines.filter(line => toNumber(line.credit) > 0).map(line => ({ accountId: line.accountId, description: `GR/IR reversal - ${bill.number}`, debit: toNumber(line.credit), credit: 0 })),
      ...original.lines.filter(line => toNumber(line.debit) > 0).map(line => ({ accountId: line.accountId, description: `Inventory reversal - ${bill.number}`, debit: 0, credit: toNumber(line.debit) })),
    ];
    await postJournalEntry(tx, { organizationId: orgId, date: opts.date, memo: `Un-receive: ${bill.number}`, source: 'REVERSAL', lines });
  }

  // The receipt bill was already soft-deleted by the atomic claim above.
}
