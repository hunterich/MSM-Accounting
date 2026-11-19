/**
 * Settlement reconciliation service (wallet model).
 *
 * The order-import (②, `lib/marketplace-import.ts`) already booked, per order:
 * a sales invoice, then a settlement *receipt* (`ARPayment`) into the
 * connection's wallet (`holdingAccount`) — so the wallet holds a debit equal to
 * the order's gross X. This service reads the platform settlement statement and,
 * per settled order, books the platform fees against that same wallet, dropping
 * it from X to the order's net released N. The net stays in the wallet to be
 * withdrawn to the real bank later; the settlement itself never touches a real
 * bank account.
 *
 * Per order, in its OWN transaction (so one bad order does not roll back the
 * batch):
 *   1. Find ②'s invoice + receipt by `poNumber`. No match → skip.
 *   2. If the receipt is already settled (`settledAt`) → idempotent no-op.
 *   3. Build fee lines from the connection's form-configured `ShopMappings`
 *      (one line per non-zero charge), routing each canonical fee key to its
 *      GL account; income-type keys credit, fee/cost keys debit.
 *   4. Credit the wallet by (X − N − linked refunds), avoiding a second refund.
 *   5. If the entry does not balance, plug the residue into the configured
 *      adjustment account; if none is configured, throw.
 *   6. Post the balanced entry and stamp `settledAt` + `settlementJournalId` on
 *      the receipt.
 *
 * All GL posting reuses `postJournalEntry`; this module writes no journal code
 * of its own beyond assembling the lines.
 */
import { prisma } from '@/lib/prisma';
import { postJournalEntry, JournalLineInput, BALANCE_TOLERANCE } from '@/lib/journal-posting';
import { KEY_TO_SLOT, SettlementFeeKey } from '@/src/utils/settlementMapping';
import { assertPeriodOpen } from './period-guard';
import { matchMarketplaceRefund } from './marketplace-refund';

/**
 * Charge keys whose magnitude flows INTO the wallet (revenue / subsidy), so they
 * credit their GL account and add to what the platform releases. Everything else
 * is a fee/cost the platform withholds and so debits its account.
 */
const INCOME_KEYS: SettlementFeeKey[] = ['buyerShipping', 'shippingRebate', 'platformRebate'];

export interface SettlementOrderInput {
  orderId: string;
  /** Calendar date on which this order's settlement was released, YYYY-MM-DD. */
  settlementDate?: string;
  netReleased: number;
  /** Canonical fee key → magnitude (always positive). */
  charges: Record<string, number>;
  /** A later refund debit only; it must not contain the original payout again. */
  refundOnly?: boolean;
  refundCreditNoteNumbers?: string[];
}

export interface SettlementResult {
  posted: number;
  alreadySettled: number;
  skipped: Array<{ orderId: string; netReleased: number }>;
  failed: Array<{ orderId: string; reason: string }>;
}

export async function importSettlement(
  orgId: string,
  userId: string,
  connectionId: string,
  input: { orders: SettlementOrderInput[] },
): Promise<SettlementResult> {
  const conn = await prisma.ecommerceConnection.findFirst({
    where: { id: connectionId, organizationId: orgId },
  });
  if (!conn) throw new Error('Connection not found');
  if (!conn.holdingAccountId) throw new Error('Connection has no settlement/holding account');

  const m =
    conn.mappings && typeof conn.mappings === 'object' && !Array.isArray(conn.mappings)
      ? (conn.mappings as Record<string, Record<string, string | null>>)
      : {};
  const adjustmentAccountId = m.fees?.adjustmentAccountId || null;
  const accountFor = (key: SettlementFeeKey): string | null => {
    const [group, field] = KEY_TO_SLOT[key];
    return (m[group]?.[field] as string) || adjustmentAccountId;
  };

  const result: SettlementResult = { posted: 0, alreadySettled: 0, skipped: [], failed: [] };

  for (const order of input.orders) {
    try {
      const outcome = await prisma.$transaction(
        async (tx): Promise<'posted' | 'skipped' | 'already'> => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([orgId, order.orderId])}, 0))`;
          // 1. Find ②'s invoice (gross X) for this marketplace order.
          const invoice = await tx.salesInvoice.findFirst({
            where: { organizationId: orgId, poNumber: order.orderId, status: { not: 'VOID' } },
            select: { id: true, number: true, totalAmount: true },
          });
          if (!invoice) return 'skipped';

          // 2. Find ②'s settlement receipt via its allocation.
          const alloc = await tx.aRPaymentAllocation.findFirst({
            where: { invoiceId: invoice.id, payment: { organizationId: orgId, ecommerceConnectionId: connectionId, source: 'MARKETPLACE_IMPORT', status: 'COMPLETED' } },
            select: { paymentId: true },
          });
          if (!alloc) {
            const unverified = await tx.aRPaymentAllocation.findFirst({
              where: { invoiceId: invoice.id }, select: { paymentId: true },
            });
            if (unverified) throw new Error('The allocated receipt cannot be verified as a completed import for this shop. It may be a legacy receipt; review its provenance before settlement.');
            return 'skipped';
          }
          const receipt = await tx.aRPayment.findFirst({
            where: { id: alloc.paymentId, organizationId: orgId, ecommerceConnectionId: connectionId, source: 'MARKETPLACE_IMPORT', status: 'COMPLETED' },
            select: { id: true, settledAt: true, depositAccountId: true, journalEntryId: true },
          });
          if (!receipt) throw new Error('The allocated receipt cannot be verified as a completed import for this shop. It may be a legacy receipt; review its provenance before settlement.');
          if (!receipt.depositAccountId || !receipt.journalEntryId) throw new Error('The original settlement account is missing from this receipt; review it before settlement.');

          const refund = order.charges.refund ?? 0;
          if (refund < 0) throw new Error('Refund must be a positive magnitude.');
          if ((order.refundOnly || order.refundCreditNoteNumbers?.length) && refund <= 0) throw new Error('Enter a positive refund amount.');
          const matched = refund > 0 ? await matchMarketplaceRefund(tx, {
            orgId, invoiceId: invoice.id, receiptId: receipt.id, walletAccountId: receipt.depositAccountId,
            amount: refund, noteNumbers: order.refundCreditNoteNumbers ?? [],
          }) : null;
          if (order.refundOnly) {
            if (!receipt.settledAt) throw new Error('Reconcile the original payout before importing a later refund.');
            if (Math.abs(order.netReleased + refund) > BALANCE_TOLERANCE ||
                Object.entries(order.charges).some(([key, amount]) => key !== 'refund' && amount !== 0)) {
              throw new Error('A later refund row must contain only the refund debit (net released = minus refund). Review fees and other adjustments separately.');
            }
            if (matched!.alreadyReconciled) return 'already';
            await tx.creditNote.updateMany({ where: { id: { in: matched!.noteIds } }, data: {
              marketplaceRefundReceiptId: receipt.id, marketplaceRefundReconciledAt: new Date(),
            } });
            // The refund note already credited the wallet. No second expense or JE.
            return 'posted';
          }
          if (receipt.settledAt) {
            if (matched && !matched.alreadyReconciled) throw new Error('This order is already settled. Import the later refund using refund-only mode.');
            return 'already';
          }
          if (matched?.alreadyReconciled) throw new Error('This refund was already reconciled; review the original settlement.');

          const X = Number(invoice.totalAmount);
          const N = order.netReleased;

          // 3. One GL line per non-zero charge, routed to its configured account.
          const lines: JournalLineInput[] = [];
          for (const [k, mag] of Object.entries(order.charges)) {
            const key = k as SettlementFeeKey;
            if (key === 'refund') continue; // already posted by the linked credit note
            if (!KEY_TO_SLOT[key] || !mag) continue;
            if (key === 'growthXtraFee' && !m.fees?.growthXtraAccountId) {
              throw new Error('Select a Growth Xtra fee account in the shop connection before importing this settlement.');
            }
            const acct = accountFor(key);
            if (!acct) continue;
            const income = INCOME_KEYS.includes(key);
            lines.push({
              accountId: acct,
              description: `${key} - ${invoice.number}`,
              debit: income ? 0 : mag,
              credit: income ? mag : 0,
            });
          }

          // 4. Credit the difference still unbooked after linked refund notes.
          lines.push({
            accountId: receipt.depositAccountId,
            description: `Wallet settlement - ${invoice.number}`,
            debit: X - N - refund < 0 ? N + refund - X : 0,
            credit: X - N - refund > 0 ? X - N - refund : 0,
          });

          // 5. Plug any residue (statement vs. our derived fees) into adjustment.
          const totDebit = lines.reduce((s, l) => s + l.debit, 0);
          const totCredit = lines.reduce((s, l) => s + l.credit, 0);
          const plug = totCredit - totDebit;
          if (Math.abs(plug) > BALANCE_TOLERANCE) {
            if (!adjustmentAccountId) {
              throw new Error(
                `Settlement for ${order.orderId} does not balance and no adjustment account is configured`,
              );
            }
            lines.push({
              accountId: adjustmentAccountId,
              description: `Settlement adjustment - ${invoice.number}`,
              debit: plug > 0 ? plug : 0,
              credit: plug < 0 ? -plug : 0,
            });
          }

          // 6. Post and stamp the receipt as settled.
          // Treat the statement's local calendar date as a date-only value, not
          // a server-local timestamp (which can shift the accounting period).
          const dateText = order.settlementDate ?? '';
          const settledOn = new Date(`${dateText}T00:00:00.000Z`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !Number.isFinite(settledOn.valueOf()) || settledOn.toISOString().slice(0, 10) !== dateText) {
            throw new Error('Enter the actual settlement date in YYYY-MM-DD format.');
          }
          await assertPeriodOpen(tx, orgId, settledOn);
          const je = await postJournalEntry(tx, {
            organizationId: orgId,
            date: settledOn,
            memo: `Settlement: ${invoice.number}`,
            source: 'SYSTEM',
            lines,
          });
          await tx.aRPayment.update({
            where: { id: receipt.id },
            data: { settledAt: new Date(), settlementJournalId: je.id },
          });
          if (matched) await tx.creditNote.updateMany({ where: { id: { in: matched.noteIds } }, data: {
            marketplaceRefundReceiptId: receipt.id, marketplaceRefundReconciledAt: new Date(),
          } });
          return 'posted';
        },
      );

      if (outcome === 'posted') result.posted += 1;
      else if (outcome === 'already') result.alreadySettled += 1;
      else result.skipped.push({ orderId: order.orderId, netReleased: order.netReleased });
    } catch (error) {
      result.failed.push({
        orderId: order.orderId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
