import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertNoDirectControlPosting } from './control-account-guard';

/** Refund cash/holding movements never clear invoice/bill debt. */
export async function validateNoteRefundAccount(
  tx: Prisma.TransactionClient, orgId: string, settlementType: string | null | undefined,
  settlementAccountId: string | null | undefined, explicitControlId?: string | null,
): Promise<void> {
  if (settlementType !== 'REFUND' && settlementType !== 'REFUND_FROM_VENDOR') return;
  const account = settlementAccountId ? await tx.account.findFirst({ where: {
    id: settlementAccountId, organizationId: orgId, isActive: true, isPostable: true, type: 'ASSET',
  }, select: { id: true } }) : null;
  if (!account) throw new ApiError('Choose an active, postable refund asset account in this organization', 422);
  const message = 'Refunds cannot use AR/AP control accounts. Choose a cash, bank or permitted holding asset account.';
  if (account.id === explicitControlId) throw new ApiError(message, 422);
  try { await assertNoDirectControlPosting(tx, orgId, [account.id]); }
  catch (error) {
    if (error instanceof ApiError && error.status === 422) throw new ApiError(message, 422);
    throw error;
  }
}
