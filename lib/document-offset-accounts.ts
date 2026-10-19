import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertNoDirectControlPosting } from './control-account-guard';

/** Offset fields cannot make party-control movements without party subledger entries. */
export async function assertDocumentOffsetAccounts(
  tx: Prisma.TransactionClient, orgId: string, accountIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const valid = await tx.account.findMany({ where: { organizationId: orgId, id: { in: ids }, isActive: true, isPostable: true }, select: { id: true } });
  if (valid.length !== ids.length) throw new ApiError('Offset accounts must be active, postable accounts belonging to this company.', 422);
  try { await assertNoDirectControlPosting(tx, orgId, ids); }
  catch (error) {
    if (error instanceof ApiError && error.status === 422) throw new ApiError('AR/AP control accounts cannot be used for document lines, additional costs or stock-adjustment offsets. Choose a non-control account.', 422);
    throw error;
  }
}

/** Revalidate stored selections before submission, including old drafts. */
export async function assertStoredDocumentOffsets(tx: Prisma.TransactionClient, orgId: string, type: string, id: string): Promise<void> {
  if (type === 'BILL') {
    const doc = await tx.bill.findFirst({ where: { id, organizationId: orgId }, select: { lines: { select: { accountId: true } }, charges: { select: { accountId: true } } } });
    if (doc) await assertDocumentOffsetAccounts(tx, orgId, [...doc.lines, ...doc.charges].map(line => line.accountId));
  } else if (type === 'INVOICE') {
    const doc = await tx.salesInvoice.findFirst({ where: { id, organizationId: orgId }, select: { charges: { select: { accountId: true } } } });
    if (doc) await assertDocumentOffsetAccounts(tx, orgId, doc.charges.map(line => line.accountId));
  } else if (type === 'STOCK_ADJUSTMENT') {
    const doc = await tx.stockAdjustment.findFirst({ where: { id, organizationId: orgId }, select: { lines: { select: { accountId: true } } } });
    if (doc) await assertDocumentOffsetAccounts(tx, orgId, doc.lines.map(line => line.accountId));
  }
}
