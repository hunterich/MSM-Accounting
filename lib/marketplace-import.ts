/**
 * Marketplace import orchestrator.
 *
 * Turns parsed Shopee/TikTok orders into real, GL-posted sales. For each order,
 * in its OWN transaction (so one bad order does not roll back the batch):
 *   1. Skip orders already imported (idempotent by `poNumber`).
 *   2. Reject the whole order if any line maps to an INACTIVE item.
 *   3. Create a SalesInvoice (+ lines), finalize to SENT (posts revenue + per-line
 *      COGS, allowing negative stock since imported items may have 0 stock).
 *   4. Record a settlement receipt (ARPayment) into the connection's holding
 *      account, marking the invoice PAID.
 *
 * All GL posting reuses the shared finalize helpers — this module writes no
 * journal lines of its own.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { calculateInvoiceTotals } from './invoice-totals';
import { nextInvoiceNumber } from './invoice-number';
import { postInvoiceSend } from './invoice-send-posting';
import { postArPaymentIfNeeded } from './payment-posting';
import { nextNumber } from './api-utils';
import {
  loadOrgAccountDefaults,
  resolveBankLinkedAssetAccountId,
} from './account-defaults';
import { toNumber } from './money';

export interface ImportOrderLine {
  itemId: string;
  description: string;
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface ImportOrder {
  orderNo: string;
  issueDate: string;
  lines: ImportOrderLine[];
}

export interface ImportOptions {
  /** Override the connection's default customer for these orders. */
  customerId?: string;
  /** Record a settlement receipt into the connection's holding account. */
  recordPayment: boolean;
}

export interface ImportResult {
  created: number;
  skipped: number;
  failed: Array<{ orderNo: string; reason: string }>;
}

/**
 * Resolve the connection's holding BankAccount to its GL asset account so the
 * settlement receipt posts Dr <bank GL> / Cr AR. `EcommerceConnection.holdingAccountId`
 * is a BankAccount id (not a GL Account id), and `postArPaymentIfNeeded` passes
 * `depositAccountId` straight to the ledger — so we must map it here, the same
 * way bank-transaction posting does. Returns null if no holding account is set
 * (the caller then skips the receipt rather than posting to a guessed account).
 */
async function resolveSettlementGlAccountId(
  tx: Prisma.TransactionClient,
  orgId: string,
  holdingBankAccountId: string,
): Promise<string | null> {
  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const bankAccountRows = await tx.bankAccount.findMany({
    where: { organizationId: orgId },
    select: { id: true, code: true, name: true, bankName: true },
  });
  const bankAccounts = bankAccountRows.map((b) => ({
    id: b.id,
    name: b.name ?? undefined,
    code: b.code ?? undefined,
    bankName: b.bankName ?? undefined,
  }));
  const settings = await loadOrgAccountDefaults(tx, orgId);
  return resolveBankLinkedAssetAccountId(bankAccounts, accounts, settings, holdingBankAccountId);
}

export async function importMarketplaceOrders(
  orgId: string,
  userId: string,
  connectionId: string,
  orders: ImportOrder[],
  options: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };

  // Load the connection ONCE up front; it is constant across the batch.
  const conn = await prisma.ecommerceConnection.findFirst({
    where: { id: connectionId, organizationId: orgId },
    select: { id: true, customerId: true, holdingAccountId: true, mappings: true },
  });
  if (!conn) {
    throw new Error(`Ecommerce connection not found: ${connectionId}`);
  }

  const customerId = options.customerId || conn.customerId;
  if (!customerId) {
    throw new Error('No customer to attribute imported orders to: set a default customer on the connection or pass options.customerId');
  }

  // Org tax defaults (read once) feed calculateInvoiceTotals. Tax-inclusive is a
  // per-connection setting stored in the `mappings` JSON (`vatInclusive`).
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { taxEnabled: true, taxDefaultRate: true, taxInclusiveByDefault: true },
  });
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }
  const taxInclusive = Boolean(
    conn.mappings && typeof conn.mappings === 'object' && !Array.isArray(conn.mappings)
      ? (conn.mappings as Record<string, unknown>).vatInclusive
      : false,
  );

  for (const order of orders) {
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Idempotency — skip orders already imported (ignore VOID re-use).
        const existing = await tx.salesInvoice.findFirst({
          where: {
            organizationId: orgId,
            poNumber: order.orderNo,
            status: { not: 'VOID' },
          },
          select: { id: true },
        });
        if (existing) {
          result.skipped += 1;
          return;
        }

        // 2. Inactive guard — reject the WHOLE order if any line maps to an
        // inactive item. (A blocked order posts nothing; it lands in `failed`.)
        const itemIds = Array.from(
          new Set(order.lines.map((l) => l.itemId).filter((id): id is string => Boolean(id))),
        );
        const items = await tx.item.findMany({
          where: { id: { in: itemIds }, organizationId: orgId },
          select: { id: true, name: true, isActive: true },
        });
        const itemsById = new Map(items.map((i) => [i.id, i]));
        for (const line of order.lines) {
          const item = itemsById.get(line.itemId);
          if (!item) {
            throw new Error(`Order line references an unknown product: ${line.itemId}`);
          }
          if (!item.isActive) {
            throw new Error(`Order contains an inactive product: ${item.name}`);
          }
        }

        // 3. Totals via the shared calculator (same shape the UI route builds).
        const totals = calculateInvoiceTotals(
          {
            lines: order.lines.map((l) => ({
              itemId: l.itemId,
              description: l.description,
              code: l.sku || null,
              quantity: l.quantity,
              unit: 'PCS',
              price: l.unitPrice,
              discountPct: 0,
            })),
            tax: { inclusive: taxInclusive },
          },
          {
            taxEnabled: org.taxEnabled,
            taxDefaultRate: org.taxDefaultRate,
            taxInclusiveByDefault: org.taxInclusiveByDefault,
          },
        );

        const issueDate = new Date(order.issueDate);
        if (Number.isNaN(issueDate.getTime())) {
          throw new Error(`Invalid order date: ${order.issueDate}`);
        }

        const number = await nextInvoiceNumber(tx, orgId);

        const invoice = await tx.salesInvoice.create({
          data: {
            organizationId: orgId,
            createdById: userId,
            number,
            customerId,
            poNumber: order.orderNo,
            issueDate,
            currency: 'IDR',
            status: 'DRAFT',
            discountPct: totals.discountPct,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            taxEnabled: totals.taxEnabled,
            taxInclusive: totals.taxInclusive,
            taxRate: totals.taxRate,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            lines: { create: totals.lines },
          },
          select: { id: true, totalAmount: true },
        });

        // 4. Finalize to SENT — posts AR revenue + per-line COGS. Imported items
        // may carry 0 stock, so negative stock is allowed for this finalize.
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: { status: 'SENT' },
        });
        await postInvoiceSend(tx, orgId, invoice.id, { allowNegativeStock: true });

        // 5. Settlement receipt — record the marketplace payout against the
        // invoice and mark it PAID.
        const invoiceTotal = toNumber(invoice.totalAmount);
        if (options.recordPayment && conn.holdingAccountId && invoiceTotal > 0) {
          const depositAccountId = await resolveSettlementGlAccountId(
            tx,
            orgId,
            conn.holdingAccountId,
          );
          const paymentNumber = await nextNumber(tx, 'ARPayment', 'number', 'ARP');
          const payment = await tx.aRPayment.create({
            data: {
              organizationId: orgId,
              number: paymentNumber,
              customerId,
              date: issueDate,
              method: 'BANK_TRANSFER',
              status: 'COMPLETED',
              depositAccountId: depositAccountId ?? undefined,
              totalAmount: invoiceTotal,
              allocations: {
                create: [{ invoiceId: invoice.id, amountApplied: invoiceTotal }],
              },
            },
            select: { id: true },
          });
          await postArPaymentIfNeeded(tx, orgId, payment.id);
          await tx.salesInvoice.update({
            where: { id: invoice.id },
            data: { status: 'PAID' },
          });
        }

        result.created += 1;
      });
    } catch (error) {
      result.failed.push({
        orderNo: order.orderNo,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
