import { Prisma } from '@prisma/client';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
export interface SalesSummaryFilter {
  organizationId: string;
  dateFrom?: Date;
  dateTo?: Date;
  customerSearch?: string;
}

// Bound transaction volume in PostgreSQL, not in application memory. All values
// are parameters, including search text; no caller-supplied SQL is interpolated.
function salesWhere(filter: SalesSummaryFilter) {
  return Prisma.sql`i."organizationId" = ${filter.organizationId} AND c."organizationId" = ${filter.organizationId}
    AND i."status" IN ('SENT', 'OVERDUE', 'PAID')
    ${filter.dateFrom ? Prisma.sql`AND i."issueDate" >= ${filter.dateFrom}` : Prisma.empty}
    ${filter.dateTo ? Prisma.sql`AND i."issueDate" <= ${filter.dateTo}` : Prisma.empty}
    ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c."name"), lower(${filter.customerSearch})) > 0` : Prisma.empty}`;
}


/** Invoice sales and applied credit notes, each recognized on its own date.
 * CreditNote.amount already includes its taxAmount, including REFUND notes.
 */
function customerSalesMovements(filter: SalesSummaryFilter) {
  return Prisma.sql`
    SELECT i."customerId", c.name AS "customerName", i."issueDate" AS date,
      1 AS "invoiceCount", i."totalAmount" AS total
    FROM "SalesInvoice" i JOIN "Customer" c ON c.id = i."customerId"
    WHERE ${salesWhere(filter)}
    UNION ALL
    SELECT n."customerId", c.name AS "customerName", n.date,
      0 AS "invoiceCount", -n.amount AS total
    FROM "CreditNote" n JOIN "Customer" c ON c.id = n."customerId"
    WHERE n."organizationId" = ${filter.organizationId} AND c."organizationId" = ${filter.organizationId}
      AND n.status = 'APPLIED'
      ${filter.dateFrom ? Prisma.sql`AND n.date >= ${filter.dateFrom}` : Prisma.empty}
      ${filter.dateTo ? Prisma.sql`AND n.date <= ${filter.dateTo}` : Prisma.empty}
      ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c.name), lower(${filter.customerSearch})) > 0` : Prisma.empty}
      AND (n."sourceInvoiceId" IS NULL OR EXISTS (
        SELECT 1 FROM "SalesInvoice" source WHERE source.id = n."sourceInvoiceId"
          AND source."organizationId" = ${filter.organizationId} AND source."customerId" = n."customerId"
          AND source.status IN ('SENT', 'OVERDUE', 'PAID')
      ))
  `;
}

export async function readCustomerSales(db: Reader, filter: SalesSummaryFilter) {
  const rows = await db.$queryRaw<Array<{
    customerId: string; customerName: string; invoiceCount: number; total: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH movements AS (${customerSalesMovements(filter)})
    SELECT "customerId", "customerName", SUM("invoiceCount")::int AS "invoiceCount", SUM(total) AS total
    FROM movements GROUP BY "customerId", "customerName"
    ORDER BY total DESC, "customerId" ASC`);
  return rows.map((row) => ({ ...row, total: Number(row.total) }));
}

export async function readItemSales(db: Reader, filter: SalesSummaryFilter) {
  const rows = await db.$queryRaw<Array<{
    description: string; code: string | null; qty: Prisma.Decimal; total: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT l.description, MIN(l.code) AS code,
      SUM(l.quantity) AS qty, SUM(l."lineSubtotal") AS total
    FROM "SalesInvoiceLine" l JOIN "SalesInvoice" i ON i.id = l."invoiceId"
      JOIN "Customer" c ON c.id = i."customerId"
    WHERE ${salesWhere(filter)}
    GROUP BY l.description ORDER BY total DESC, l.description ASC`);
  return rows.map((row) => ({ ...row, qty: Number(row.qty), total: Number(row.total) }));
}

export async function readTopProducts(db: Reader, filter: SalesSummaryFilter) {
  const rows = await db.$queryRaw<Array<{
    itemId: string; sku: string; name: string; qty: Prisma.Decimal; total: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT l."itemId", m.sku, m.name,
      SUM(l.quantity) AS qty, SUM(l."lineSubtotal") AS total
    FROM "SalesInvoiceLine" l JOIN "SalesInvoice" i ON i.id = l."invoiceId"
      JOIN "Customer" c ON c.id = i."customerId"
      JOIN "Item" m ON m.id = l."itemId"
    WHERE ${salesWhere(filter)}
    GROUP BY l."itemId", m.sku, m.name ORDER BY qty DESC, l."itemId" ASC`);
  return rows.map((row) => ({ ...row, qty: Number(row.qty), total: Number(row.total) }));
}

export async function readItemCustomerSales(db: Reader, filter: SalesSummaryFilter) {
  const rows = await db.$queryRaw<Array<{
    customerName: string; description: string; qty: Prisma.Decimal; total: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT c.name AS "customerName", l.description,
      SUM(l.quantity) AS qty, SUM(l."lineSubtotal") AS total
    FROM "SalesInvoiceLine" l JOIN "SalesInvoice" i ON i.id = l."invoiceId"
      JOIN "Customer" c ON c.id = i."customerId"
    WHERE ${salesWhere(filter)}
    GROUP BY i."customerId", c.name, l.description
    ORDER BY total DESC, i."customerId" ASC, l.description ASC`);
  return rows.map((row) => ({ ...row, qty: Number(row.qty), total: Number(row.total) }));
}

export async function readSalesCalendar(
  db: Reader,
  filter: SalesSummaryFilter,
  period: 'day' | 'month',
  customerId?: string,
) {
  const format = period === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const rows = await db.$queryRaw<Array<{
    bucket: string; invoiceCount: number; total: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH movements AS (${customerSalesMovements(filter)})
    SELECT to_char(date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', ${format}) AS bucket,
      SUM("invoiceCount")::int AS "invoiceCount", SUM(total) AS total
    FROM movements
    ${customerId === undefined ? Prisma.empty : Prisma.sql`WHERE "customerId" = ${customerId}`}
    GROUP BY bucket ORDER BY bucket ASC`);
  return rows.map((row) => ({ ...row, total: Number(row.total) }));
}
