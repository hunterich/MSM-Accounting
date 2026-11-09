import type { Prisma } from '@prisma/client';
import { assertDocumentOffsetAccounts } from './document-offset-accounts';
import { InventoryDocumentType, Prisma as PrismaRuntime } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { calculateAndPostCOGS, lockInventoryItems } from './inventory-costing';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { toNumber, asMoney } from './money';
import { postJournalEntry } from './journal-posting';
import type { TransactionDateGuardOptions } from './transaction-date-policy';
import { itemPostingAccount } from './item-posting-accounts';

/**
 * Posts the GL + COGS for an invoice transitioning to SENT.
 * Extracted verbatim from invoices/[id] PUT (DRAFT→SENT). Must run inside a $transaction.
 * Loads the invoice's own issueDate for the period guard. Does NOT change invoice.status —
 * the caller sets SENT.
 */
export async function postInvoiceSend(
  tx: Prisma.TransactionClient,
  orgId: string,
  invoiceId: string,
  opts: { allowNegativeStock?: boolean; warehouseId?: string | null } & TransactionDateGuardOptions = {},
): Promise<void> {
  const invoice = await tx.salesInvoice.findUnique({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      number: true,
      issueDate: true,
      subtotal: true,
      discountAmount: true,
      totalAmount: true,
      taxAmount: true,
      taxInclusive: true,
      taxRate: true,
      charges: { select: { accountId: true, amount: true, taxRate: true } },
    },
  });

  if (!invoice) {
    throw new ApiError('Invoice not found', 404);
  }

  const invoiceNumber = invoice.number;
  await assertDocumentOffsetAccounts(tx, orgId, invoice.charges.map(charge => charge.accountId));
  const postingJournalIds: string[] = [];
  const invoiceLines = await tx.salesInvoiceLine.findMany({
    where: { invoiceId }, select: { id: true, itemId: true, quantity: true, lineSubtotal: true }, orderBy: { lineNo: 'asc' },
  });
  await lockInventoryItems(tx, orgId, invoiceLines.flatMap(line => line.itemId ? [line.itemId] : []));

  // Refuse to post into a closed/locked accounting period.
  await assertPeriodOpen(tx, orgId, new Date(invoice.issueDate), opts);
  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const itemIdsForPosting = [...new Set(invoiceLines.flatMap(line => line.itemId ? [line.itemId] : []))];
  const postingItems = itemIdsForPosting.length ? await tx.item.findMany({
    where: { id: { in: itemIdsForPosting }, organizationId: orgId },
    select: { id: true, revenueAccountId: true, inventoryAccountId: true, cogsAccountId: true },
  }) : [];
  const postingItemById = new Map(postingItems.map(item => [item.id, item]));
  if (itemIdsForPosting.some(id => !postingItemById.has(id))) throw new ApiError('An invoice item is unavailable in this company.', 422);

  const totalAmount = toNumber(invoice.totalAmount);
  const taxAmount = toNumber(invoice.taxAmount);
  const discountAmount = toNumber(invoice.discountAmount);
  // Revenue is gross of any discount line we post separately below;
  // when we post a contra-revenue discount line, salesRevenue is
  // credited at the larger pre-discount amount.
  const baseRevenue = totalAmount - taxAmount;
  const arAccountId = resolveAccountDefaultId(accounts, settings, 'arControl');
  const salesAccountId = resolveAccountDefaultId(accounts, settings, 'salesRevenue');
  const revenueByLine = new Map(invoiceLines.map(line => {
    const item = line.itemId ? postingItemById.get(line.itemId) : undefined;
    return [line.id, itemPostingAccount(accounts, item?.revenueAccountId, salesAccountId, 'REVENUE', 'revenue')] as const;
  }));
  const taxAccountId = taxAmount > 0
    ? resolveAccountDefaultId(accounts, settings, 'arTax')
    : null;
  const salesDiscountAccountId =
    discountAmount > 0
      ? (resolveAccountDefaultId(accounts, settings, 'salesDiscount')
        || resolveAccountDefaultId(accounts, settings, 'arDiscount'))
      : null;
  const roundingAccountId =
    resolveAccountDefaultId(accounts, settings, 'roundingAccount')
    || resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  const arInvoiceDate = new Date(invoice.issueDate);

  // Additional costs (charges) on a sale are income/recovery: each credits its
  // own account (typically a freight/other-income revenue account) instead of
  // inflating sales revenue. The charge amount is already inside totalAmount
  // (and its tax inside taxAmount), so we split the charge net OUT of the sales
  // credit. A charge with no/invalid account (or coded to sales) stays folded
  // into sales revenue. NET extraction mirrors computeTotals for tax-inclusive.
  const taxInclusive = Boolean(invoice.taxInclusive);
  const rate = toNumber(invoice.taxRate) / 100;
  const postableById = new Set(accounts.filter((a) => a.isPostable).map((a) => a.id));
  const chargesByAccount = new Map<string, number>();
  let chargesCreditTotal = 0;
  for (const charge of invoice.charges ?? []) {
    const amt = toNumber(charge.amount);
    if (amt === 0) continue;
    const chargeTaxable = taxAmount > 0 && toNumber(charge.taxRate) > 0;
    const cnet = chargeTaxable && taxInclusive && rate > 0 ? asMoney(amt / (1 + rate)) : amt;
    const acc = charge.accountId;
    if (!acc || !postableById.has(acc) || acc === salesAccountId) continue; // folds into sales
    chargesByAccount.set(acc, (chargesByAccount.get(acc) ?? 0) + cnet);
    chargesCreditTotal += cnet;
  }
  chargesCreditTotal = asMoney(chargesCreditTotal);

  if (totalAmount > 0 && arAccountId && salesAccountId && (taxAmount === 0 || taxAccountId)) {
    const splitDiscount = discountAmount > 0 && Boolean(salesDiscountAccountId);
    const revenueCredit = asMoney(
      (splitDiscount ? asMoney(baseRevenue + discountAmount) : baseRevenue) - chargesCreditTotal,
    );
    const arLines: Array<{ accountId: string; description: string; debit: number; credit: number }> = [
      {
        accountId: arAccountId,
        description: `AR - ${invoice.number}`,
        debit: totalAmount,
        credit: 0,
      },
    ];
    const customRevenue = [...revenueByLine.values()].some(id => id !== salesAccountId);
    if (!customRevenue) {
      // Preserve the exact existing journal shape for blank/default mappings.
      arLines.push({ accountId: salesAccountId, description: `Sales - ${invoice.number}`, debit: 0, credit: revenueCredit });
    } else {
      const weights = invoiceLines.map(line => new PrismaRuntime.Decimal(line.lineSubtotal ?? 0));
      if (weights.some(weight => weight.isNegative())) throw new ApiError('Cannot allocate sales revenue across negative invoice lines.', 422);
      const sum = weights.reduce((total, weight) => total.plus(weight), new PrismaRuntime.Decimal(0));
      if (sum.isZero() || revenueCredit < 0) throw new ApiError('Cannot allocate sales revenue across these invoice lines.', 422);
      let cumulative = new PrismaRuntime.Decimal(0), assigned = new PrismaRuntime.Decimal(0);
      const totals = new Map<string, PrismaRuntime.Decimal>();
      for (const [index, line] of invoiceLines.entries()) {
        cumulative = cumulative.plus(weights[index]);
        const rounded = new PrismaRuntime.Decimal(revenueCredit).mul(cumulative).div(sum).toDecimalPlaces(2, PrismaRuntime.Decimal.ROUND_HALF_UP);
        const amount = rounded.minus(assigned); assigned = rounded;
        const accountId = revenueByLine.get(line.id);
        if (!accountId) throw new ApiError('An invoice line has no sales revenue account.', 422);
        totals.set(accountId, (totals.get(accountId) ?? new PrismaRuntime.Decimal(0)).plus(amount));
      }
      for (const [accountId, amount] of totals) if (!amount.isZero()) {
        arLines.push({ accountId, description: `Sales - ${invoice.number}`, debit: 0, credit: amount.toNumber() });
      }
    }
    for (const line of invoiceLines) await tx.salesInvoiceLine.update({ where: { id: line.id }, data: { revenuePostingAccountId: revenueByLine.get(line.id) ?? null } });
    for (const [accountId, amount] of chargesByAccount) {
      if (amount > 0) {
        arLines.push({ accountId, description: `Additional cost - ${invoice.number}`, debit: 0, credit: asMoney(amount) });
      }
    }
    if (splitDiscount && salesDiscountAccountId) {
      arLines.push({
        accountId: salesDiscountAccountId,
        description: `Sales discount - ${invoice.number}`,
        debit: discountAmount,
        credit: 0,
      });
    }
    if (taxAmount > 0 && taxAccountId) {
      arLines.push({
        accountId: taxAccountId,
        description: `Output tax - ${invoice.number}`,
        debit: 0,
        credit: taxAmount,
      });
    }

    // Tax-inclusive math frequently leaves a sub-rupiah residual
    // between totalAmount and (revenue - discount + tax). Book it to
    // the rounding account so the entry balances exactly.
    const sumDebits  = arLines.reduce((s, l) => s + l.debit, 0);
    const sumCredits = arLines.reduce((s, l) => s + l.credit, 0);
    const rounding = asMoney(sumDebits - sumCredits);
    if (Math.abs(rounding) > 0 && roundingAccountId) {
      arLines.push({
        accountId: roundingAccountId,
        description: `Rounding - ${invoice.number}`,
        debit:  rounding < 0 ? -rounding : 0,
        credit: rounding > 0 ?  rounding : 0,
      });
    }

    const arEntry = await postJournalEntry(tx, {
      organizationId: orgId,
      date: arInvoiceDate,
      memo: `Sales recognition: ${invoice.number}`,
      lines: arLines,
    });
    postingJournalIds.push(arEntry.id);
  }

  const organization = await tx.organization.findUnique({
    where: { id: orgId },
    select: { costingMethod: true },
  });

  if (organization?.costingMethod) {
    const itemIds = invoiceLines
      .map((l) => l.itemId)
      .filter((itemId): itemId is string => Boolean(itemId));

    if (itemIds.length > 0) {
      const inventoryItems = await tx.item.findMany({
        where: {
          id: { in: itemIds },
          organizationId: orgId,
          type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
        },
        select: { id: true },
      });
      const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

      const linesWithInventory = invoiceLines.filter(
        (l) => l.itemId && inventoryItemIds.has(l.itemId),
      );

      if (linesWithInventory.length > 0) {
        const defaultCogsAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');
        const defaultInventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
        const invoiceDate = new Date(invoice.issueDate);

        // Never relieve inventory without booking COGS. If the accounts
        // can't be resolved, block the SEND so revenue is not recognised
        // while the inventory asset is left overstated on the books.
        for (const line of linesWithInventory) {
          const qty = toNumber(line.quantity);
          if (qty <= 0 || !line.itemId) continue;
          const item = postingItemById.get(line.itemId)!;
          const cogsAccountId = itemPostingAccount(accounts, item.cogsAccountId, defaultCogsAccountId, 'EXPENSE', 'COGS');
          const inventoryAccountId = itemPostingAccount(accounts, item.inventoryAccountId, defaultInventoryAccountId, 'ASSET', 'inventory');
          if (!cogsAccountId || !inventoryAccountId) throw new ApiError(`Cannot post COGS for ${invoiceNumber}: no Inventory Asset / COGS account is configured. Map default accounts in Settings before sending invoices with stocked items.`, 422);

          const lots = await tx.inventoryLot.findMany({ where: {
            organizationId: orgId, itemId: line.itemId, qtyBalance: { gt: 0 },
            ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
          }, include: { inboundLedgerEntry: { select: { inventoryPostingAccountId: true } } } });

          const cogs = await calculateAndPostCOGS(
            tx,
            orgId,
            line.itemId,
            opts.warehouseId ?? null,
            qty,
            InventoryDocumentType.SALES,
            invoiceId,
            invoiceDate,
            { allowNegativeStock: opts.allowNegativeStock ?? false, inventoryPostingAccountId: inventoryAccountId, cogsPostingAccountId: cogsAccountId },
          );

          if (cogs > 0 && lots.some(lot => !lot.inboundLedgerEntry?.inventoryPostingAccountId)) {
            throw new ApiError('Original stock account history is unavailable. Review the historical stock before posting this sale.', 422);
          }
          if (cogs > 0 && lots.some(lot => lot.inboundLedgerEntry?.inventoryPostingAccountId !== inventoryAccountId)) {
            throw new ApiError('Recorded stock and the item use different inventory accounts. Review the stock account history before posting this sale.', 422);
          }

          await tx.salesInvoiceLine.update({
            where: { id: line.id },
            data: { cogsAmount: cogs, inventoryPostingAccountId: inventoryAccountId, cogsPostingAccountId: cogsAccountId },
          });

          if (cogs > 0) {
            const cogsEntry = await postJournalEntry(tx, {
              organizationId: orgId,
              date: invoiceDate,
              memo: `COGS auto-post: ${invoiceNumber}`,
              lines: [
                {
                  accountId: cogsAccountId,
                  description: `COGS - ${invoiceNumber}`,
                  debit: cogs,
                  credit: 0,
                },
                {
                  accountId: inventoryAccountId,
                  description: `Inventory reduction - ${invoiceNumber}`,
                  debit: 0,
                  credit: cogs,
                },
              ],
            });
            postingJournalIds.push(cogsEntry.id);
          }
        }
      }
    }
  }
  await tx.salesInvoice.update({ where: { id: invoiceId }, data: { postingTracked: true, postingJournalIds } });
}
