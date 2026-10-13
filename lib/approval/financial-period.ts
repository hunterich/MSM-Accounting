import { Prisma, type ApprovalDocumentType } from '@prisma/client';
import { ApiError } from '../errors';
import { lockOpenAccountingPeriod } from '../period-guard';

// These finalizers post money or valued stock. Orders alone post neither.
// Identifiers below are a static whitelist, never request-supplied SQL.
const FINANCIAL_DOCUMENTS: Partial<Record<ApprovalDocumentType, { table: string; dateColumn: string }>> = {
  INVOICE: { table: 'SalesInvoice', dateColumn: 'issueDate' },
  BILL: { table: 'Bill', dateColumn: 'issueDate' },
  CREDIT_NOTE: { table: 'CreditNote', dateColumn: 'date' },
  DEBIT_NOTE: { table: 'DebitNote', dateColumn: 'date' },
  AR_PAYMENT: { table: 'ARPayment', dateColumn: 'date' },
  AP_PAYMENT: { table: 'APPayment', dateColumn: 'date' },
  SALES_RETURN: { table: 'SalesReturn', dateColumn: 'returnDate' },
  PURCHASE_RETURN: { table: 'PurchaseReturn', dateColumn: 'returnDate' },
  STOCK_ADJUSTMENT: { table: 'StockAdjustment', dateColumn: 'date' },
  PAYROLL_RUN: { table: 'PayrollRun', dateColumn: 'periodEnd' },
};
const identifier = (value: string) => Prisma.raw(`"${value}"`);

/** Submission and posting share the period lock so close cannot miss a newly
 * committed pending document. Only period closure is checked here; posting
 * retains its existing transaction-date-window/override policy.
 */
export async function lockFinancialApprovalPeriod(tx: Prisma.TransactionClient, orgId: string, kind: ApprovalDocumentType, id: string): Promise<void> {
  const descriptor = FINANCIAL_DOCUMENTS[kind];
  if (!descriptor) return;
  const rows = await tx.$queryRaw<Array<{ date: Date }>>(Prisma.sql`
    SELECT ${identifier(descriptor.dateColumn)} AS date FROM ${identifier(descriptor.table)}
    WHERE "organizationId" = ${orgId} AND "id" = ${id} FOR UPDATE`);
  if (!rows[0]) throw new ApiError('Financial document not found in organization', 404);
  await lockOpenAccountingPeriod(tx, orgId, rows[0].date);
}

/** Count documents, not request timestamps. This includes orphaned pending
 * documents and excludes other periods/companies and non-posting order holds.
 */
export async function pendingFinancialInPeriod(tx: Prisma.TransactionClient, orgId: string, start: Date, end: Date): Promise<Array<{ documentType: string; count: number }>> {
  const queries = Object.entries(FINANCIAL_DOCUMENTS).map(([kind, descriptor]) => Prisma.sql`
    SELECT ${kind} AS "documentType", count(*)::int AS count FROM ${identifier(descriptor.table)}
    WHERE "organizationId" = ${orgId} AND "status"::text = 'PENDING_APPROVAL'
      AND ${identifier(descriptor.dateColumn)} >= ${start} AND ${identifier(descriptor.dateColumn)} <= ${end}`);
  return tx.$queryRaw(Prisma.join(queries, ' UNION ALL '));
}
