import { Prisma } from '@prisma/client';
import { BALANCE_TOLERANCE } from './journal-posting';
import { toNumber } from './money';

/** Validate the financial leg already posted by credit notes; never infer receipt of goods. */
export async function matchMarketplaceRefund(
  tx: Prisma.TransactionClient,
  input: { orgId: string; invoiceId: string; receiptId: string; walletAccountId: string; amount: number; noteNumbers: string[] },
) {
  const numbers = [...new Set(input.noteNumbers)];
  if (!numbers.length || numbers.length !== input.noteNumbers.length) {
    throw new Error('Enter the linked refund credit note number(s), without duplicates. Create the sales return and apply its refund credit note first.');
  }
  // Same order lock as settlement, plus note row locks shared with note posting/void.
  await tx.$queryRaw`SELECT "id" FROM "CreditNote" WHERE "organizationId" = ${input.orgId} AND "number" IN (${Prisma.join(numbers)}) ORDER BY "id" FOR UPDATE`;
  const notes = await tx.creditNote.findMany({ where: {
    organizationId: input.orgId, number: { in: numbers }, sourceInvoiceId: input.invoiceId,
    settlementType: 'REFUND', status: 'APPLIED', journalEntryId: { not: null },
    settlementAccountId: input.walletAccountId,
    salesReturn: { organizationId: input.orgId, invoiceId: input.invoiceId, postedAt: { not: null }, status: { not: 'VOID' } },
  } });
  if (notes.length !== numbers.length) {
    throw new Error('Each refund needs an applied credit note linked to this order and a posted sales return, refunding the original marketplace clearing account.');
  }
  const total = notes.reduce((sum, note) => sum + toNumber(note.amount), 0);
  if (Math.abs(total - input.amount) > BALANCE_TOLERANCE) {
    throw new Error('Settlement refund does not equal the linked credit note total. Review the refund before reconciling.');
  }
  if (notes.some(note => note.marketplaceRefundReceiptId && note.marketplaceRefundReceiptId !== input.receiptId)) {
    throw new Error('A credit note has already been reconciled to another marketplace receipt.');
  }
  const linked = notes.filter(note => note.marketplaceRefundReceiptId);
  if (linked.length && linked.length !== notes.length) {
    throw new Error('Do not mix previously reconciled credit notes with new refunds in one settlement row.');
  }
  return { noteIds: notes.map(note => note.id), alreadyReconciled: linked.length === notes.length };
}

