/**
 * GL + inventory posting for SalesReturn approval.
 *
 * Design (per locked plan, Option B):
 *   - SalesReturn handles ONLY the inventory side: DR Inventory / CR COGS at
 *     the restock value.
 *   - The linked CreditNote (when issued) handles the financial side
 *     (DR arReturn / CR arControl) — already implemented elsewhere.
 *   - Tax reversal is out of scope here (item #3, separate PR).
 *
 * Cost basis: the source invoice line's actual posted COGS. Goods retained by
 * the customer affect neither inventory nor COGS; the credit note handles money.
 *
 * Idempotent under an invoice lock via postedAt, including returns with no JE.
 */
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { addCostLayer, lockInventoryItems } from './inventory-costing';
import { lockSalesReturns, prepareSalesReturnLines, originalSalesLineCost } from './sales-return-lines';
import { ApiError } from './errors';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';
import { assertPeriodOpen } from './period-guard';
import type { TransactionDateGuardOptions } from './transaction-date-policy';

type Tx = Prisma.TransactionClient;

export async function postSalesReturnOnApproval(
  tx: Tx,
  salesReturnId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const initial = await tx.salesReturn.findUnique({ where: { id: salesReturnId } });
  if (!initial) return;
  await lockSalesReturns(tx, initial.organizationId, initial.invoiceId);
  const sr = await tx.salesReturn.findUnique({
    where: { id: salesReturnId },
    include: { lines: true },
  });
  if (!sr || sr.journalEntryId || sr.postedAt) return;
  if (sr.status === 'VOID') throw new ApiError('Cannot post a voided sales return', 422);

  // Refuse to post inventory/GL into a closed/locked accounting period.
  await assertPeriodOpen(tx, sr.organizationId, sr.returnDate, opts);

  const invoice = await tx.salesInvoice.findFirst({
    where: { id: sr.invoiceId, organizationId: sr.organizationId },
    select: { status: true },
  });
  if (!invoice || !['SENT', 'PAID', 'OVERDUE'].includes(invoice.status)) {
    throw new ApiError('Post the source invoice before finalizing its return', 422);
  }
  const prepared = await prepareSalesReturnLines(
    tx, sr.organizationId, sr.invoiceId, sr.customerId, sr.lines, sr.id,
  );

  const itemIds = sr.lines
    .map((l) => l.itemId)
    .filter((x): x is string => Boolean(x));

  const inventoryItems = itemIds.length
    ? await tx.item.findMany({
        where: {
          id: { in: itemIds },
          organizationId: sr.organizationId,
          type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
        },
        select: { id: true },
      })
    : [];
  const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));
  // Shared by direct creation, draft finalization and approval finalization:
  // invoice-return lock -> sorted items -> journal numbering.
  await lockInventoryItems(tx, sr.organizationId, [...inventoryItemIds]);

  const priorLines = await tx.salesReturnLine.findMany({
    where: { salesReturn: {
      organizationId: sr.organizationId, invoiceId: sr.invoiceId,
      id: { not: sr.id }, status: { not: 'VOID' }, postedAt: { not: null },
    } },
  });
  const postedQty = new Map<string, Prisma.Decimal>();
  const postedCost = new Map<string, Prisma.Decimal>();
  for (const prior of priorLines) {
    if (!prior.goodsReceived || new MoneyDecimal(prior.qtyReturn).lte(0)) continue;
    const sourceId = prior.sourceInvoiceLineId ?? prepared.find((l) => l.itemId === prior.itemId)?.source.id;
    if (!sourceId) continue;
    postedQty.set(sourceId, new MoneyDecimal(postedQty.get(sourceId) ?? 0).plus(prior.qtyReturn));
    let priorCost = new MoneyDecimal(prior.inventoryCost ?? 0);
    if (prior.inventoryCost == null && prior.itemId && inventoryItemIds.has(prior.itemId)) {
      const ledger = await tx.inventoryLedgerEntry.findMany({ where: {
        organizationId: sr.organizationId, documentType: 'SALES_RETURN',
        documentId: prior.salesReturnId, itemId: prior.itemId,
      } });
      priorCost = ledger.reduce((sum, entry) => sum.plus(entry.valueChange), new MoneyDecimal(0));
    }
    postedCost.set(sourceId, new MoneyDecimal(postedCost.get(sourceId) ?? 0).plus(priorCost));
  }

  let totalRestockValue = new MoneyDecimal(0);
  const inventoryByAccount = new Map<string, Prisma.Decimal>();
  const cogsByAccount = new Map<string, Prisma.Decimal>();
  for (const [index, line] of sr.lines.entries()) {
    const qty = new MoneyDecimal(line.qtyReturn);
    const { source } = prepared[index];
    const cumulativeQty = qty.plus(postedQty.get(source.id) ?? 0);
    await tx.salesReturnLine.update({
      where: { id: line.id },
      data: { sourceInvoiceLineId: source.id, inventoryCost: 0 },
    });
    if (qty.lte(0) || !line.goodsReceived || !line.itemId || !inventoryItemIds.has(line.itemId)) continue;
    const saleCost = await originalSalesLineCost(tx, sr.organizationId, source);
    // Cumulative rounding makes successive partial returns add to the sale cost.
    const previousCost = new MoneyDecimal(postedCost.get(source.id) ?? 0);
    if (previousCost.gt(saleCost)) throw new ApiError('Earlier returns exceed the original sale cost. Review their inventory postings before receiving more goods.', 422);
    const cost = MoneyDecimal.max(0, roundMoneyDecimal(saleCost.mul(cumulativeQty).div(source.quantity)).minus(previousCost));
    if (cost.gt(0) && (!source.inventoryPostingAccountId || !source.cogsPostingAccountId)) {
      throw new ApiError('Original sale account history is unavailable. Review the historical invoice before receiving its return.', 422);
    }
    if (cost.gt(0)) {
      const inventoryId = source.inventoryPostingAccountId!;
      const cogsId = source.cogsPostingAccountId!;
      inventoryByAccount.set(inventoryId, cost.plus(inventoryByAccount.get(inventoryId) ?? 0));
      cogsByAccount.set(cogsId, cost.plus(cogsByAccount.get(cogsId) ?? 0));
    }
    postedQty.set(source.id, cumulativeQty);
    postedCost.set(source.id, previousCost.plus(cost));
    await addCostLayer(
      tx,
      sr.organizationId,
      line.itemId,
      sr.warehouseId ?? null,
      qty.toNumber(),
      cost.div(qty).toNumber(),
      InventoryDocumentType.SALES_RETURN,
      sr.id,
      sr.returnDate,
      cost.toNumber(),
      cost.gt(0) ? source.inventoryPostingAccountId : undefined,
    );
    await tx.salesReturnLine.update({ where: { id: line.id }, data: { inventoryCost: cost } });
    totalRestockValue = totalRestockValue.plus(cost);
  }

  if (totalRestockValue.lte(0)) {
    // Services, goods kept by the customer, or zero-cost stock.
    // Mark posted but skip JE — nothing to debit/credit.
    await tx.salesReturn.update({
      where: { id: sr.id },
      data: { postedAt: new Date() },
    });
    return;
  }

  const je = await postJournalEntry(tx, {
    organizationId: sr.organizationId,
    date: sr.returnDate,
    memo: `Sales return inventory: ${sr.number}`,
    lines: [
      ...[...inventoryByAccount].map(([accountId, amount]) => ({
        accountId,
        description: `Inventory restock - ${sr.number}`,
        debit: amount,
        credit: 0,
      })),
      ...[...cogsByAccount].map(([accountId, amount]) => ({
        accountId,
        description: `COGS reversal - ${sr.number}`,
        debit: 0,
        credit: amount,
      })),
    ],
  });

  await tx.salesReturn.update({
    where: { id: sr.id },
    data: { journalEntryId: je.id, postedAt: new Date() },
  });
}
