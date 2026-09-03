/**
 * Roll payment allocations up into the document's own status.
 *
 * Outstanding balances are always *derived* from allocations (aging, credit
 * limit, over-allocation guard), but the list screens and the void rules read
 * `SalesInvoice.status` / `Bill.status`. Nothing used to write PAID there, so a
 * fully settled invoice stayed "Sent" and a paid bill stayed "Unpaid" with live
 * Pay / Void buttons. Every path that changes what a payment settles calls one
 * of these after its own write:
 *
 *   - create / update a payment (routes)          → allocations changed
 *   - approval finalizer                           → status became COMPLETED
 *   - void                                         → allocations removed
 *
 * The rule mirrors the aging report: only allocations of COMPLETED payments
 * clear a document, and a cash discount clears it alongside the cash applied
 * (a penalty is extra income, not settlement). PAID is reversible — a voided
 * receipt puts the invoice back to SENT (the bill back to OPEN) — while DRAFT,
 * PENDING_APPROVAL and VOID documents are never touched.
 */
import type { Prisma } from '@prisma/client';
import { asMoney, toNumber } from './money';

type Tx = Prisma.TransactionClient;

const TOLERANCE = 0.01;

/** Invoice statuses that a payment may settle into PAID. */
const INVOICE_OPEN_STATUSES = new Set(['SENT', 'OVERDUE']);
/** Bill statuses that a payment may settle into PAID. */
const BILL_OPEN_STATUSES = new Set(['OPEN', 'PENDING', 'OVERDUE']);

export type SettlementTransition = 'PAID' | 'REOPENED' | null;

/**
 * Re-derive one invoice's status from its COMPLETED-payment allocations.
 * Returns the transition applied, or null when nothing changed.
 */
export async function syncInvoiceSettlementStatus(
  tx: Tx,
  orgId: string,
  invoiceId: string,
): Promise<SettlementTransition> {
  const invoice = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: { id: true, status: true, totalAmount: true },
  });
  if (!invoice) return null;

  const cleared = await tx.aRPaymentAllocation.aggregate({
    where: { invoiceId, payment: { status: 'COMPLETED' } },
    _sum: { amountApplied: true, discountAmount: true },
  });
  const settled = isSettled(
    toNumber(invoice.totalAmount),
    toNumber(cleared._sum.amountApplied) + toNumber(cleared._sum.discountAmount),
  );

  if (settled && INVOICE_OPEN_STATUSES.has(invoice.status)) {
    await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', updatedAt: new Date() } });
    return 'PAID';
  }
  if (!settled && invoice.status === 'PAID') {
    await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'SENT', updatedAt: new Date() } });
    return 'REOPENED';
  }
  return null;
}

/** Bill twin of `syncInvoiceSettlementStatus`; a reopened bill goes back to OPEN. */
export async function syncBillSettlementStatus(
  tx: Tx,
  orgId: string,
  billId: string,
): Promise<SettlementTransition> {
  const bill = await tx.bill.findFirst({
    where: { id: billId, organizationId: orgId },
    select: { id: true, status: true, totalAmount: true },
  });
  if (!bill) return null;

  const cleared = await tx.aPPaymentAllocation.aggregate({
    where: { billId, payment: { status: 'COMPLETED' } },
    _sum: { amountApplied: true, discountAmount: true },
  });
  const settled = isSettled(
    toNumber(bill.totalAmount),
    toNumber(cleared._sum.amountApplied) + toNumber(cleared._sum.discountAmount),
  );

  if (settled && BILL_OPEN_STATUSES.has(bill.status)) {
    await tx.bill.update({ where: { id: bill.id }, data: { status: 'PAID', updatedAt: new Date() } });
    return 'PAID';
  }
  if (!settled && bill.status === 'PAID') {
    await tx.bill.update({ where: { id: bill.id }, data: { status: 'OPEN', updatedAt: new Date() } });
    return 'REOPENED';
  }
  return null;
}

/**
 * Sync every invoice an AR receipt touches. `alsoInvoiceIds` carries invoices
 * the payment *used to* allocate to (an edit that moved the money elsewhere,
 * a void that just deleted the rows) so they can fall back out of PAID.
 */
export async function syncArPaymentSettlement(
  tx: Tx,
  orgId: string,
  paymentId: string,
  alsoInvoiceIds: readonly string[] = [],
): Promise<void> {
  const allocations = await tx.aRPaymentAllocation.findMany({
    where: { paymentId },
    select: { invoiceId: true },
  });
  const ids = new Set<string>([...allocations.map((a) => a.invoiceId), ...alsoInvoiceIds]);
  for (const invoiceId of ids) {
    await syncInvoiceSettlementStatus(tx, orgId, invoiceId);
  }
}

/** AP twin of `syncArPaymentSettlement`. */
export async function syncApPaymentSettlement(
  tx: Tx,
  orgId: string,
  paymentId: string,
  alsoBillIds: readonly string[] = [],
): Promise<void> {
  const allocations = await tx.aPPaymentAllocation.findMany({
    where: { paymentId },
    select: { billId: true },
  });
  const ids = new Set<string>([...allocations.map((a) => a.billId), ...alsoBillIds]);
  for (const billId of ids) {
    await syncBillSettlementStatus(tx, orgId, billId);
  }
}

/** A document is settled once the cleared amount reaches its total (to the cent). */
export function isSettled(totalAmount: number, clearedAmount: number): boolean {
  return asMoney(clearedAmount) >= asMoney(totalAmount) - TOLERANCE;
}
