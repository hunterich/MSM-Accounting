import { Prisma } from '@prisma/client';

/** One aggregate row, regardless of invoice or allocation history size. */
export async function dashboardAging(db: Pick<Prisma.TransactionClient, '$queryRaw'>, organizationId: string, now: Date) {
  const instant = now.toISOString(); // Explicit offset survives a non-UTC database session.
  const [row] = await db.$queryRaw<Array<Record<string, Prisma.Decimal | bigint>>>(Prisma.sql`
    WITH invoices AS (
      SELECT id, "dueDate", "totalAmount" FROM "SalesInvoice"
      WHERE "organizationId" = ${organizationId} AND status IN ('SENT','OVERDUE','PAID')
    ), cleared AS (
      SELECT a."invoiceId", ROUND(SUM(a."amountApplied" + a."discountAmount"), 2) AS amount
      FROM "ARPaymentAllocation" a
      JOIN "ARPayment" p ON p.id = a."paymentId"
      JOIN invoices i ON i.id = a."invoiceId"
      WHERE p."organizationId" = ${organizationId} AND p.status = 'COMPLETED'
      GROUP BY a."invoiceId"
    ), notes AS (
      SELECT n."sourceInvoiceId", SUM(n.amount) AS amount FROM "CreditNote" n
      JOIN invoices i ON i.id = n."sourceInvoiceId"
      WHERE n."organizationId" = ${organizationId} AND n.status = 'APPLIED'
        AND n."settlementType" = 'APPLY_TO_INVOICE'
      GROUP BY n."sourceInvoiceId"
    ), outstanding AS (
      SELECT GREATEST(ROUND(i."totalAmount" - COALESCE(c.amount, 0) - COALESCE(n.amount, 0), 2), 0) AS amount,
        COALESCE((${instant}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date -
          (i."dueDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date, 0) AS days
      FROM invoices i LEFT JOIN cleared c ON c."invoiceId" = i.id
      LEFT JOIN notes n ON n."sourceInvoiceId" = i.id
    )
    SELECT COALESCE(SUM(amount) FILTER (WHERE days <= 0), 0) AS current,
      COALESCE(SUM(amount) FILTER (WHERE days BETWEEN 1 AND 30), 0) AS "d1To30",
      COALESCE(SUM(amount) FILTER (WHERE days BETWEEN 31 AND 60), 0) AS "d31To60",
      COALESCE(SUM(amount) FILTER (WHERE days BETWEEN 61 AND 90), 0) AS "d61To90",
      COALESCE(SUM(amount) FILTER (WHERE days > 90), 0) AS "d90Plus",
      COALESCE(SUM(amount), 0) AS "totalOutstanding",
      COUNT(*) FILTER (WHERE amount > 0 AND days > 0) AS "overdueInvoiceCount",
      COALESCE(SUM(amount) FILTER (WHERE days > 0), 0) AS "overdueAmount"
    FROM outstanding
  `);
  const money = (key: string) => Number(row[key]);
  return {
    aging: { current: money('current'), d1To30: money('d1To30'), d31To60: money('d31To60'), d61To90: money('d61To90'), d90Plus: money('d90Plus'), totalOutstanding: money('totalOutstanding') },
    overdueInvoiceCount: Number(row.overdueInvoiceCount), overdueAmount: money('overdueAmount'),
  };
}
