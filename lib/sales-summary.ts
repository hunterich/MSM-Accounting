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
  return Prisma.sql`i."organizationId" = ${filter.organizationId}
    AND i."status" IN ('SENT', 'OVERDUE', 'PAID')
    ${filter.dateFrom ? Prisma.sql`AND i."issueDate" >= ${filter.dateFrom}` : Prisma.empty}
    ${filter.dateTo ? Prisma.sql`AND i."issueDate" <= ${filter.dateTo}` : Prisma.empty}
    ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c."name"), lower(${filter.customerSearch})) > 0` : Prisma.empty}`;
}

export async function readCustomerSales(db: Reader, filter: SalesSummaryFilter) {
  const rows = await db.$queryRaw<Array<{
    customerId: string; customerName: string; invoiceCount: number; total: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT i."customerId", c."name" AS "customerName",
      COUNT(*)::int AS "invoiceCount", SUM(i."totalAmount") AS total
    FROM "SalesInvoice" i JOIN "Customer" c ON c.id = i."customerId"
    WHERE ${salesWhere(filter)}
    GROUP BY i."customerId", c."name"
    ORDER BY total DESC, i."customerId" ASC`);
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
  // Explicit business timezone gives identical buckets on Windows and Linux.
  const format = period === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const rows = await db.$queryRaw<Array<{
    bucket: string; invoiceCount: number; total: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT to_char(i."issueDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', ${format}) AS bucket,
      COUNT(*)::int AS "invoiceCount", SUM(i."totalAmount") AS total
    FROM "SalesInvoice" i JOIN "Customer" c ON c.id = i."customerId"
    WHERE ${salesWhere(filter)}
      ${customerId === undefined ? Prisma.empty : Prisma.sql`AND i."customerId" = ${customerId}`}
    GROUP BY bucket ORDER BY bucket ASC`);
  return rows.map((row) => ({ ...row, total: Number(row.total) }));
}
