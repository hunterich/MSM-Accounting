import { Prisma } from '@prisma/client';
import { asMoney } from './money';

/** Net period sales (including PPN); settlement stays scoped to period invoices. */
export function dashboardSalesQuery(
  organizationId: string, dateFrom: Date, dateTo: Date, today: Date, asOf: Date,
) {
  return Prisma.sql`
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
      SELECT n."sourceInvoiceId", SUM(n.amount) AS returned,
        COALESCE(SUM(n.amount) FILTER (WHERE n."settlementType" = 'APPLY_TO_INVOICE'), 0) AS applied
      FROM "CreditNote" n JOIN invoices i ON i.id = n."sourceInvoiceId"
      WHERE n."organizationId" = ${organizationId} AND n.status = 'APPLIED' AND n.date <= ${asOf}
      GROUP BY n."sourceInvoiceId"
    ), period_returns AS (
      SELECT COALESCE(SUM(n.amount), 0) AS amount FROM "CreditNote" n
      WHERE n."organizationId" = ${organizationId} AND n.status = 'APPLIED'
        AND n.date BETWEEN ${dateFrom} AND ${dateTo} AND n.date <= ${asOf}
        AND (n."sourceInvoiceId" IS NULL OR EXISTS (
          SELECT 1 FROM "SalesInvoice" source WHERE source.id = n."sourceInvoiceId"
            AND source."organizationId" = ${organizationId} AND source."customerId" = n."customerId"
            AND source.status IN ('SENT', 'OVERDUE', 'PAID')
        ))
    ), balances AS (
      SELECT i.*,
        GREATEST(ROUND(i."totalAmount" - COALESCE(p.amount, 0) - COALESCE(n.applied, 0), 2), 0) AS unpaid,
        GREATEST(LEAST(COALESCE(p.amount, 0), i."totalAmount" - COALESCE(n.returned, 0)), 0) AS paid
      FROM invoices i LEFT JOIN payments p ON p."invoiceId" = i.id
      LEFT JOIN notes n ON n."sourceInvoiceId" = i.id
    )
    SELECT COALESCE(SUM("totalAmount") FILTER (WHERE "issueDate" BETWEEN ${dateFrom} AND ${dateTo}), 0) AS "grossSales",
      (SELECT amount FROM period_returns) AS returns,
      COALESCE(SUM(paid) FILTER (WHERE "issueDate" BETWEEN ${dateFrom} AND ${dateTo}), 0) AS paid,
      COALESCE(SUM(unpaid) FILTER (WHERE "issueDate" BETWEEN ${dateFrom} AND ${dateTo}), 0) AS unpaid,
      COALESCE(SUM(unpaid) FILTER (WHERE "dueDate" IS NULL OR "dueDate" >= ${today}), 0) AS current,
      COALESCE(SUM(unpaid) FILTER (WHERE "dueDate" < ${today}), 0) AS overdue
    FROM balances
  `;
}

/** One aggregate row; no invoice/payment/note collections enter application memory. */
export async function readDashboardSales(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  organizationId: string, dateFrom: Date, dateTo: Date, today: Date, asOf: Date,
) {
  const [row] = await db.$queryRaw<Array<Record<string, Prisma.Decimal>>>(
    dashboardSalesQuery(organizationId, dateFrom, dateTo, today, asOf),
  );
  const grossSales = Number(row.grossSales), returns = Number(row.returns);
  const current = Number(row.current), overdue = Number(row.overdue);
  return {
    sales: asMoney(grossSales - returns), grossSales, returns,
    paid: asMoney(Number(row.paid)), unpaid: asMoney(Number(row.unpaid)),
    current, overdue, outstanding: asMoney(current + overdue),
  };
}
