import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer, lockInventoryItems } from '@/lib/inventory-costing';
import { postJournalEntry } from '@/lib/journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { ApiError } from '@/lib/errors';

export interface ReceiveBatchInput {
  itemId: string;
  warehouseId: string | null;
  batchNumber: string;
  expiryDate: Date;
  qty: number;
  unitCost: number;
  date: Date;
}

/**
 * Receive a pharmaceutical batch: upsert the physical StockBatch, add the MSM
 * cost layer + perpetual inventory ledger, and post DR Inventory / CR Opening
 * Balance Equity. Must run inside a $transaction.
 */
export async function receiveBatch(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: ReceiveBatchInput,
): Promise<string> {
  const { itemId, warehouseId, batchNumber, expiryDate, qty, unitCost, date } = input;
  await lockInventoryItems(tx, orgId, [itemId]);

  const value = Math.round((qty * unitCost + Number.EPSILON) * 100) / 100;
  let inventoryAccountId: string | null = null;
  let equityAccountId: string | null = null;
  if (value > 0) {
    const accounts = await tx.account.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    });
    const settings = await loadOrgAccountDefaults(tx, orgId);
    inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
    equityAccountId = resolveAccountDefaultId(accounts, settings, 'openingBalanceEquity');
    // Validate BEFORE a physical batch, cost layer or movement is changed.
    if (!inventoryAccountId || !equityAccountId) {
      throw new ApiError('Cannot receive opening batch stock: configure Inventory Asset and Opening Balance Equity accounts in Settings first.', 422);
    }
  }

  const existing = await tx.stockBatch.findFirst({
    where: { organizationId: orgId, itemId, warehouseId, batchNumber, expiryDate },
    select: { id: true, qtyOnHand: true },
  });
  const batchId = existing
    ? (await tx.stockBatch.update({
        where: { id: existing.id },
        data: { qtyOnHand: { increment: qty }, unitCost },
        select: { id: true },
      })).id
    : (await tx.stockBatch.create({
        data: { organizationId: orgId, itemId, warehouseId, batchNumber, expiryDate, qtyOnHand: qty, unitCost, receivedAt: date },
        select: { id: true },
      })).id;

  await addCostLayer(tx, orgId, itemId, warehouseId, qty, unitCost, InventoryDocumentType.OPENING, batchId, date);

  if (value > 0 && inventoryAccountId && equityAccountId) {
    await postJournalEntry(tx, {
      organizationId: orgId,
      date,
      memo: `POS batch receipt: ${batchNumber}`,
      lines: [
        { accountId: inventoryAccountId, description: `Inventory receipt - ${batchNumber}`, debit: value, credit: 0 },
        { accountId: equityAccountId, description: `Opening equity - ${batchNumber}`, debit: 0, credit: value },
      ],
    });
  }

  return batchId;
}
