import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { calculateAndPostCOGS } from './inventory-costing';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { toNumber, asMoney } from './money';
import { postJournalEntry } from './journal-posting';

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
): Promise<void> {
  const invoice = await tx.salesInvoice.findUnique({
    where: { id: invoiceId },
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

  // Refuse to post into a closed/locked accounting period.
  await assertPeriodOpen(tx, orgId, new Date(invoice.issueDate));
  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);

  const totalAmount = toNumber(invoice.totalAmount);
  const taxAmount = toNumber(invoice.taxAmount);
  const discountAmount = toNumber(invoice.discountAmount);
  // Revenue is gross of any discount line we post separately below;
  // when we post a contra-revenue discount line, salesRevenue is
  // credited at the larger pre-discount amount.
  const baseRevenue = totalAmount - taxAmount;
  const arAccountId = resolveAccountDefaultId(accounts, settings, 'arControl');
  const salesAccountId = resolveAccountDefaultId(accounts, settings, 'salesRevenue');
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
      {
        accountId: salesAccountId,
        description: `Sales - ${invoice.number}`,
        debit: 0,
        credit: revenueCredit,
      },
    ];
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

    await postJournalEntry(tx, {
      organizationId: orgId,
      date: arInvoiceDate,
      memo: `Sales recognition: ${invoice.number}`,
      lines: arLines,
    });
  }

  const organization = await tx.organization.findUnique({
    where: { id: orgId },
    select: { costingMethod: true },
  });

  if (organization?.costingMethod) {
    const invoiceLines = await tx.salesInvoiceLine.findMany({
      where: { invoiceId },
      select: { itemId: true, quantity: true },
    });

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
        const cogsAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');
        const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
        const invoiceDate = new Date(invoice.issueDate);

        // Never relieve inventory without booking COGS. If the accounts
        // can't be resolved, block the SEND so revenue is not recognised
        // while the inventory asset is left overstated on the books.
        if (!cogsAccountId || !inventoryAccountId) {
          throw new ApiError(
            `Cannot post COGS for ${invoiceNumber}: no Inventory Asset / COGS account is configured. Map default accounts in Settings before sending invoices with stocked items.`,
            422,
          );
        }

        for (const line of linesWithInventory) {
          const qty = toNumber(line.quantity);
          if (qty <= 0 || !line.itemId) continue;

          const cogs = await calculateAndPostCOGS(
            tx,
            orgId,
            line.itemId,
            null,
            qty,
            InventoryDocumentType.SALES,
            invoiceId,
            invoiceDate,
          );

          if (cogs > 0) {
            await postJournalEntry(tx, {
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
          }
        }
      }
    }
  }
}
