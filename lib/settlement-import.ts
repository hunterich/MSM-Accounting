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
 *   4. Credit the wallet by (X − N) so its balance drops to the net released.
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
import { loadBankPostingContext } from '@/lib/bank-transaction-posting';
import { resolveBankLinkedAssetAccountId } from '@/lib/account-defaults';

/**
 * Charge keys whose magnitude flows INTO the wallet (revenue / subsidy), so they
 * credit their GL account and add to what the platform releases. Everything else
 * is a fee/cost the platform withholds and so debits its account.
 */
const INCOME_KEYS: SettlementFeeKey[] = ['buyerShipping', 'shippingRebate', 'platformRebate'];

export interface SettlementOrderInput {
  orderId: string;
  netReleased: number;
  /** Canonical fee key → magnitude (always positive). */
  charges: Record<string, number>;
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

  // Resolve the wallet GL account ONCE — holdingAccountId is constant for the
  // batch. This mirrors ②'s resolution so fees land on the very account ②'s
  // receipt debited.
  const ctx = await loadBankPostingContext(prisma, orgId);
  const walletAccountId = resolveBankLinkedAssetAccountId(
    ctx.bankAccounts,
    ctx.accounts,
    ctx.settings,
    conn.holdingAccountId,
  );
  if (!walletAccountId) throw new Error('Could not resolve the wallet GL account');

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
          // 1. Find ②'s invoice (gross X) for this marketplace order.
          const invoice = await tx.salesInvoice.findFirst({
            where: { organizationId: orgId, poNumber: order.orderId, status: { not: 'VOID' } },
            select: { id: true, number: true, totalAmount: true },
          });
          if (!invoice) return 'skipped';

          // 2. Find ②'s settlement receipt via its allocation.
          const alloc = await tx.aRPaymentAllocation.findFirst({
            where: { invoiceId: invoice.id },
            select: { paymentId: true },
          });
          if (!alloc) return 'skipped';
          const receipt = await tx.aRPayment.findFirst({
            where: { id: alloc.paymentId, organizationId: orgId },
            select: { id: true, settledAt: true },
          });
          if (!receipt) return 'skipped';
          if (receipt.settledAt) return 'already';

          const X = Number(invoice.totalAmount);
          const N = order.netReleased;

          // 3. One GL line per non-zero charge, routed to its configured account.
          const lines: JournalLineInput[] = [];
          for (const [k, mag] of Object.entries(order.charges)) {
            const key = k as SettlementFeeKey;
            if (!KEY_TO_SLOT[key] || !mag) continue;
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

          // 4. Credit the wallet by (X − N): the gross drops to the net released.
          lines.push({
            accountId: walletAccountId,
            description: `Wallet settlement - ${invoice.number}`,
            debit: 0,
            credit: X - N,
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
          const je = await postJournalEntry(tx, {
            organizationId: orgId,
            date: new Date(),
            memo: `Settlement: ${invoice.number}`,
            source: 'SYSTEM',
            lines,
          });
          await tx.aRPayment.update({
            where: { id: receipt.id },
            data: { settledAt: new Date(), settlementJournalId: je.id },
          });
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
