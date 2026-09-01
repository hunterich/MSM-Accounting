/**
 * GL posting for AR/AP payments, shared by the POST (create) and PUT
 * (update/complete) routes.
 *
 * Draft payments must never touch the ledger: posting only happens once a
 * payment is in a posted-worthy status (anything except DRAFT and VOID).
 * `journalEntryId` is the idempotency token — set in the same transaction
 * as the journal entry, so re-running (e.g. PUT after PUT) is a no-op.
 */
import type { Prisma } from '@prisma/client';
import { postJournalEntry } from './journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from './account-defaults';
import { assertPeriodOpen } from './period-guard';
import { toNumber } from './money';
import type { TransactionDateGuardOptions } from './transaction-date-policy';

type Tx = Prisma.TransactionClient;

const UNPOSTABLE_STATUSES = new Set(['DRAFT', 'VOID', 'PENDING_APPROVAL']);

/** Post DR Bank / CR AR for an AR receipt, once. */
export async function postArPaymentIfNeeded(
  tx: Tx,
  orgId: string,
  paymentId: string,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  const payment = await tx.aRPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
  });
  if (!payment || payment.journalEntryId || UNPOSTABLE_STATUSES.has(payment.status)) return;

  const amount = toNumber(payment.totalAmount);
  if (amount <= 0) return;

  await assertPeriodOpen(tx, orgId, new Date(payment.date), opts);

  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const bankAccountId =
    payment.depositAccountId
    ?? resolveAccountDefaultId(accounts, settings, 'bankAsset');
  const arAccountId =
    payment.arAccountId
    ?? resolveAccountDefaultId(accounts, settings, 'arControl');

  if (!bankAccountId || !arAccountId) return;

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
        credit: amount,
      },
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
  const payment = await tx.aPPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
  });
  if (!payment || payment.journalEntryId || UNPOSTABLE_STATUSES.has(payment.status)) return;

  const amount = toNumber(payment.totalAmount);
  if (amount <= 0) return;

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

  if (!apAccountId || !bankAccountId) return;

  const je = await postJournalEntry(tx, {
    organizationId: orgId,
    date: new Date(payment.date),
    memo: `AP payment: ${payment.number}`,
    lines: [
      {
        accountId: apAccountId,
        description: `AP settlement - ${payment.number}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: bankAccountId,
        description: `Bank disbursement - ${payment.number}`,
        debit: 0,
        credit: amount,
      },
    ],
  });

  await tx.aPPayment.update({
    where: { id: payment.id },
    data: { journalEntryId: je.id },
  });
}
