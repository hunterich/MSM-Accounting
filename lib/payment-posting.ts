/**
 * GL posting for AR/AP payments, shared by the POST (create) and PUT
 * (update/complete) routes.
 *
 * Draft payments must never touch the ledger: posting only happens once a
 * payment is COMPLETED. Processing and approval holds never touch the ledger.
 * `journalEntryId` is the idempotency token — set in the same transaction
 * as the journal entry, so re-running (e.g. PUT after PUT) is a no-op.
 */
import type { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { assertPeriodOpen } from './period-guard';
import { toNumber } from './money';
import { ApiError } from './errors';
import type { TransactionDateGuardOptions } from './transaction-date-policy';
import { lockPayment, validatePaymentAllocations } from './payment-validation';
import { selectCashAccounts } from './cash-accounts';

type Tx = Prisma.TransactionClient;

const UNPOSTABLE_STATUSES = new Set(['DRAFT', 'PROCESSING', 'VOID', 'PENDING_APPROVAL']);

/** Post DR Bank / CR AR for an AR receipt, once. */
export async function postArPaymentIfNeeded(
  tx: Tx,
  orgId: string,
  paymentId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  await lockPayment(tx, orgId, 'ar', paymentId);
  const payment = await tx.aRPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    include: { allocations: true },
  });
  if (!payment || payment.journalEntryId || UNPOSTABLE_STATUSES.has(payment.status)) return;
  await validatePaymentAllocations(tx, orgId, 'ar', payment);

  const amount = toNumber(payment.totalAmount);
  if (amount <= 0) throw new ApiError('Payment total must be positive before posting', 422);

  await assertPeriodOpen(tx, orgId, new Date(payment.date), opts);

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true, parentId: true, reportGroup: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const bankAccountId =
    payment.depositAccountId
    ?? resolveAccountDefaultId(accounts, settings, 'bankAsset');
  const arAccountId =
    payment.arAccountId
    ?? resolveAccountDefaultId(accounts, settings, 'arControl');

  if (!bankAccountId || !arAccountId) throw new ApiError('Payment requires cash and receivable posting accounts', 422);
  if (!selectCashAccounts(accounts).some(account => account.id === bankAccountId)) {
    throw new ApiError('Choose an active, postable cash or bank deposit account in this organization', 422);
  }
  const discount = (payment.allocations ?? []).reduce((s, a) => s + toNumber(a.discountAmount), 0);
  const penalty = (payment.allocations ?? []).reduce((s, a) => s + toNumber(a.penaltyAmount), 0);
  const discountAccountId = payment.discountAccountId ?? resolveAccountDefaultId(accounts, settings, 'arDiscount');
  const penaltyAccountId = payment.penaltyAccountId ?? resolveAccountDefaultId(accounts, settings, 'arPenalty');
  if ((discount > 0 && !discountAccountId) || (penalty > 0 && !penaltyAccountId) || amount + discount - penalty <= 0) {
    throw new ApiError('Payment requires valid discount/penalty accounts and a positive settlement amount', 422);
  }

  const je = await postJournalEntry(tx, {
    organizationId: orgId,
    date: new Date(payment.date),
    memo: `AR receipt: ${payment.number}`,
    lines: [
      {
        accountId: bankAccountId,
        description: `Bank deposit - ${payment.number}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: arAccountId,
        description: `AR settlement - ${payment.number}`,
        debit: 0,
        credit: amount + discount - penalty,
      },
      ...(discount > 0 && discountAccountId ? [{ accountId: discountAccountId, description: `Payment discount - ${payment.number}`, debit: discount, credit: 0 }] : []),
      ...(penalty > 0 && penaltyAccountId ? [{ accountId: penaltyAccountId, description: `Late fee - ${payment.number}`, debit: 0, credit: penalty }] : []),
    ],
  });

  await tx.aRPayment.update({
    where: { id: payment.id },
    data: { journalEntryId: je.id },
  });
}

/** Post DR AP / CR Bank for an AP disbursement, once. */
export async function postApPaymentIfNeeded(
  tx: Tx,
  orgId: string,
  paymentId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  await lockPayment(tx, orgId, 'ap', paymentId);
  const payment = await tx.aPPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    include: { allocations: true },
  });
  if (!payment || payment.journalEntryId || UNPOSTABLE_STATUSES.has(payment.status)) return;
  await validatePaymentAllocations(tx, orgId, 'ap', payment);

  const amount = toNumber(payment.totalAmount);
  if (amount <= 0) throw new ApiError('Payment total must be positive before posting', 422);

  await assertPeriodOpen(tx, orgId, new Date(payment.date), opts);

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const apAccountId =
    payment.apAccountId
    ?? resolveAccountDefaultId(accounts, settings, 'apControl');
  const bankAccountId =
    payment.cashAccountId
    ?? resolveAccountDefaultId(accounts, settings, 'bankAsset');

  if (!apAccountId || !bankAccountId) throw new ApiError('Payment requires cash and payable posting accounts', 422);
  const discount = (payment.allocations ?? []).reduce((s, a) => s + toNumber(a.discountAmount), 0);
  const penalty = (payment.allocations ?? []).reduce((s, a) => s + toNumber(a.penaltyAmount), 0);
  const discountAccountId = payment.discountAccountId ?? resolveAccountDefaultId(accounts, settings, 'apDiscount');
  const penaltyAccountId = payment.penaltyAccountId ?? resolveAccountDefaultId(accounts, settings, 'apPenalty');
  if ((discount > 0 && !discountAccountId) || (penalty > 0 && !penaltyAccountId) || amount + discount - penalty <= 0) {
    throw new ApiError('Payment requires valid discount/penalty accounts and a positive settlement amount', 422);
  }

  const je = await postJournalEntry(tx, {
    organizationId: orgId,
    date: new Date(payment.date),
    memo: `AP payment: ${payment.number}`,
    lines: [
      {
        accountId: apAccountId,
        description: `AP settlement - ${payment.number}`,
        debit: amount + discount - penalty,
        credit: 0,
      },
      {
        accountId: bankAccountId,
        description: `Bank disbursement - ${payment.number}`,
        debit: 0,
        credit: amount,
      },
      ...(discount > 0 && discountAccountId ? [{ accountId: discountAccountId, description: `Payment discount - ${payment.number}`, debit: 0, credit: discount }] : []),
      ...(penalty > 0 && penaltyAccountId ? [{ accountId: penaltyAccountId, description: `Late fee - ${payment.number}`, debit: penalty, credit: 0 }] : []),
    ],
  });

  await tx.aPPayment.update({
    where: { id: payment.id },
    data: { journalEntryId: je.id },
  });
}
