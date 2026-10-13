import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from './account-defaults';

/** Public manual/banking writes cannot bypass the customer/vendor subledgers.
 * Internal opening/migration and document posting helpers do not call this.
 * A client-supplied JournalSource never grants an opening/migration exemption.
 */
export async function assertNoDirectControlPosting(tx: Prisma.TransactionClient, orgId: string, accountIds: string[]): Promise<void> {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return;
  const accounts = await tx.account.findMany({ where: { organizationId: orgId },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true } });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const defaults = [settings.arControl, settings.apControl,
    resolveAccountDefaultId(accounts, settings, 'arControl'), resolveAccountDefaultId(accounts, settings, 'apControl'),
    resolveAccountDefaultId(accounts, {}, 'arControl'), resolveAccountDefaultId(accounts, {}, 'apControl')];
  let blocked = defaults.some(id => id && ids.includes(id));
  if (!blocked) {
    // Explicit document overrides designate additional controls, even when the
    // company's default has since changed. Never compare only the default.
    const arWhere = { organizationId: orgId, arAccountId: { in: ids } };
    const apWhere = { organizationId: orgId, apAccountId: { in: ids } };
    const references = await Promise.all([
      tx.aRPayment.findFirst({ where: arWhere, select: { id: true } }),
      tx.salesReturn.findFirst({ where: arWhere, select: { id: true } }),
      tx.creditNote.findFirst({ where: arWhere, select: { id: true } }),
      tx.bill.findFirst({ where: apWhere, select: { id: true } }),
      tx.aPPayment.findFirst({ where: apWhere, select: { id: true } }),
      tx.purchaseReturn.findFirst({ where: apWhere, select: { id: true } }),
      tx.debitNote.findFirst({ where: apWhere, select: { id: true } }),
    ]);
    blocked = references.some(Boolean);
  }
  if (blocked) throw new ApiError('AR/AP control accounts require customer/vendor documents. Use receipts, payments or notes; opening balances must use the controlled opening/migration workflow.', 422);
}
