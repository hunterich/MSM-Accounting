import { Prisma } from '@prisma/client';
import { asMoney } from './money';

/** Period invoice sales and their current settlement; outstanding covers all invoices today. */
export async function readDashboardSales(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  organizationId: string, dateFrom: Date, dateTo: Date, today: Date, asOf: Date,
) {
  const [row] = await db.$queryRaw<Array<Record<string, Prisma.Decimal>>>(Prisma.sql`
    WITH invoices AS (
      SELECT id, "issueDate", "dueDate", "totalAmount" FROM "SalesInvoice"
      WHERE "organizationId" = ${organizationId}
        AND status IN ('SENT', 'OVERDUE', 'PAID') AND "issueDate" <= ${asOf}
    ), payments AS (
      SELECT a."invoiceId", SUM(a."amountApplied" + a."discountAmount") AS amount
      FROM "ARPaymentAllocation" a JOIN "ARPayment" p ON p.id = a."paymentId"
      JOIN invoices i ON i.id = a."invoiceId"
      WHERE p."organizationId" = ${organizationId} AND p.status = 'COMPLETED' AND p.date <= ${asOf}
      GROUP BY a."invoiceId"
    ), notes AS (
      SELECT n."sourceInvoiceId", SUM(n.amount) AS amount FROM "CreditNote" n
      JOIN invoices i ON i.id = n."sourceInvoiceId"
      WHERE n."organizationId" = ${organizationId} AND n.status = 'APPLIED'
        AND n."settlementType" = 'APPLY_TO_INVOICE' AND n.date <= ${asOf}
      GROUP BY n."sourceInvoiceId"
    ), balances AS (
      SELECT i.*, GREATEST(ROUND(i."totalAmount" - COALESCE(p.amount, 0) - COALESCE(n.amount, 0), 2), 0) AS unpaid
      FROM invoices i LEFT JOIN payments p ON p."invoiceId" = i.id
      LEFT JOIN notes n ON n."sourceInvoiceId" = i.id
    )
    SELECT COALESCE(SUM("totalAmount") FILTER (WHERE "issueDate" BETWEEN ${dateFrom} AND ${dateTo}), 0) AS sales,
      COALESCE(SUM(unpaid) FILTER (WHERE "issueDate" BETWEEN ${dateFrom} AND ${dateTo}), 0) AS unpaid,
      COALESCE(SUM(unpaid) FILTER (WHERE "dueDate" IS NULL OR "dueDate" >= ${today}), 0) AS current,
      COALESCE(SUM(unpaid) FILTER (WHERE "dueDate" < ${today}), 0) AS overdue
    FROM balances
  `);
  const sales = Number(row.sales), unpaid = Number(row.unpaid);
  const current = Number(row.current), overdue = Number(row.overdue);
  return { sales, paid: asMoney(sales - unpaid), unpaid, current, overdue, outstanding: asMoney(current + overdue) };
}
