import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { toNumber } from './money';
import { assertPeriodOpen } from './period-guard';
import { reversePurchaseLayers } from './inventory-costing';
import { postJournalEntry } from './journal-posting';
import { ensureGrIrAccount } from './grir';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';

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

  // Remove the cost layers this receipt booked (throws if any was consumed).
  const valueRemoved = await reversePurchaseLayers(tx, orgId, bill.id, opts.date);

  // GL contra of the receipt: Dr GR/IR, Cr Inventory for the removed value.
  if (valueRemoved > 0) {
    const accounts = await tx.account.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    });
    const settings = await loadOrgAccountDefaults(tx, orgId);
    const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
    if (!inventoryAccountId) {
      throw new ApiError('Cannot un-receive: no Inventory asset account is configured.', 422);
    }
    const grirAccountId = await ensureGrIrAccount(tx, orgId);
    await postJournalEntry(tx, {
      organizationId: orgId,
      date: opts.date,
      memo: `Un-receive: ${bill.number}`,
      source: 'REVERSAL',
      lines: [
        { accountId: grirAccountId, description: `GR/IR reversal - ${bill.number}`, debit: valueRemoved, credit: 0 },
        { accountId: inventoryAccountId, description: `Inventory reversal - ${bill.number}`, debit: 0, credit: valueRemoved },
      ],
    });
  }

  // Roll back the PO: decrement receivedQty on each linked line, then recompute status.
  for (const line of bill.lines) {
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

  // The receipt bill no longer represents anything — soft-delete it.
  await tx.bill.update({ where: { id: bill.id }, data: { deletedAt: opts.date } });
}
