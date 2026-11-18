import { Prisma } from '@prisma/client';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
export interface SalesSummaryFilter {
  organizationId: string;
  dateFrom?: Date;
  dateTo?: Date;
  customerSearch?: string;
  excludeTax?: boolean;
}

// Bound transaction volume in PostgreSQL, not in application memory. All values
// are parameters, including search text; no caller-supplied SQL is interpolated.
function salesWhere(filter: SalesSummaryFilter) {
  return Prisma.sql`i."organizationId" = ${filter.organizationId} AND c."organizationId" = ${filter.organizationId}
    ${filter.excludeTax ? Prisma.empty : Prisma.sql`AND i."status" IN ('SENT', 'OVERDUE', 'PAID')`}
    ${filter.dateFrom ? Prisma.sql`AND ${filter.excludeTax ? Prisma.sql`event.date` : Prisma.sql`i."issueDate"`} >= ${filter.dateFrom}` : Prisma.empty}
    ${filter.dateTo ? Prisma.sql`AND ${filter.excludeTax ? Prisma.sql`event.date` : Prisma.sql`i."issueDate"`} <= ${filter.dateTo}` : Prisma.empty}
    ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c."name"), lower(${filter.customerSearch})) > 0` : Prisma.empty}`;
}


/** Invoice sales and applied credit notes, each recognized on its own date.
 * CreditNote.amount already includes its taxAmount, including REFUND notes.
 */
function customerSalesMovements(filter: SalesSummaryFilter) {
  return Prisma.sql`
    SELECT i.id, i.number, i.status::text AS status, i."customerId", c.name AS "customerName", ${filter.excludeTax ? Prisma.sql`event.date` : Prisma.sql`i."issueDate"`} AS date,
      ${filter.excludeTax ? Prisma.sql`CASE WHEN event.factor = 1 THEN 1 ELSE 0 END` : Prisma.sql`1`} AS "invoiceCount", 'invoice' AS kind, ${filter.excludeTax ? Prisma.sql`event.factor * (i."totalAmount" - i."taxAmount")` : Prisma.sql`i."totalAmount"`} AS total
    FROM "SalesInvoice" i JOIN "Customer" c ON c.id = i."customerId"
    ${filter.excludeTax ? invoiceEvents() : Prisma.empty}
    WHERE ${salesWhere(filter)}
    UNION ALL
    SELECT n.id, n.number, n.status::text AS status, n."customerId", c.name AS "customerName", ${filter.excludeTax ? Prisma.sql`event.date` : Prisma.sql`n.date`} AS date,
      0 AS "invoiceCount", 'credit' AS kind, ${filter.excludeTax ? Prisma.sql`-event.factor * (n.amount - CASE WHEN n."applyTax" THEN n."taxAmount" ELSE 0 END)` : Prisma.sql`-n.amount`} AS total
    FROM "CreditNote" n JOIN "Customer" c ON c.id = n."customerId"
    ${filter.excludeTax ? creditEvents() : Prisma.empty}
    WHERE n."organizationId" = ${filter.organizationId} AND c."organizationId" = ${filter.organizationId}
      ${filter.excludeTax ? Prisma.empty : Prisma.sql`AND n.status = 'APPLIED'`}
      ${filter.dateFrom ? Prisma.sql`AND ${filter.excludeTax ? Prisma.sql`event.date` : Prisma.sql`n.date`} >= ${filter.dateFrom}` : Prisma.empty}
      ${filter.dateTo ? Prisma.sql`AND ${filter.excludeTax ? Prisma.sql`event.date` : Prisma.sql`n.date`} <= ${filter.dateTo}` : Prisma.empty}
      ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c.name), lower(${filter.customerSearch})) > 0` : Prisma.empty}
      AND (n."sourceInvoiceId" IS NULL OR EXISTS (
        SELECT 1 FROM "SalesInvoice" source WHERE source.id = n."sourceInvoiceId"
          AND source."organizationId" = ${filter.organizationId} AND source."customerId" = n."customerId"
          ${filter.excludeTax ? Prisma.sql`AND source.status IN ('SENT', 'OVERDUE', 'PAID', 'VOID')` : Prisma.sql`AND source.status IN ('SENT', 'OVERDUE', 'PAID')`}
      ))
  `;
}

function invoiceEvents() {
  return Prisma.sql`JOIN LATERAL (
    SELECT i."issueDate" AS date, 1 AS factor WHERE i.status IN ('SENT', 'OVERDUE', 'PAID') OR
      (i.status = 'VOID' AND (SELECT COUNT(DISTINCT j.date) FROM "JournalEntry" j
        WHERE j."organizationId" = i."organizationId" AND j.status = 'POSTED' AND j.source = 'REVERSAL'
          AND j.memo = 'Void invoice: ' || i.number) = 1)
    UNION ALL
    SELECT MIN(j.date), -1 FROM "JournalEntry" j WHERE i.status = 'VOID' AND j."organizationId" = i."organizationId"
      AND j.status = 'POSTED' AND j.source = 'REVERSAL' AND j.memo = 'Void invoice: ' || i.number
      HAVING COUNT(DISTINCT j.date) = 1
  ) event ON true`;
}

// A void is a dated reversal, not an erasure of the original period. Legacy
// voids lacking one identifiable reversal cannot be reconstructed here.
function creditEvents() {
  return Prisma.sql`JOIN LATERAL (
    SELECT n.date, 1 AS factor WHERE n.status = 'APPLIED' OR (n.status = 'VOID' AND
      (SELECT count(*) FROM "JournalEntry" j WHERE j."organizationId" = n."organizationId"
        AND j.status = 'POSTED' AND j.source = 'REVERSAL' AND j.memo = 'Void credit note: ' || n.number) = 1)
    UNION ALL
    SELECT j.date, -1 FROM "JournalEntry" j WHERE n.status = 'VOID' AND j."organizationId" = n."organizationId"
      AND j.status = 'POSTED' AND j.source = 'REVERSAL' AND j.memo = 'Void credit note: ' || n.number
      AND (SELECT count(*) FROM "JournalEntry" x WHERE x."organizationId" = n."organizationId"
        AND x.status = 'POSTED' AND x.source = 'REVERSAL' AND x.memo = j.memo) = 1
  ) event ON true`;
}

export async function readCustomerSales(db: Reader, filter: SalesSummaryFilter) {
  const rows = await db.$queryRaw<Array<{
    customerId: string; customerName: string; invoiceCount: number; total: Prisma.Decimal; gross: Prisma.Decimal; returns: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH movements AS (${customerSalesMovements(filter)})
    SELECT "customerId", "customerName", SUM("invoiceCount")::int AS "invoiceCount", SUM(total) AS total,
      COALESCE(SUM(total) FILTER (WHERE kind = 'invoice'), 0) AS gross,
      -COALESCE(SUM(total) FILTER (WHERE kind = 'credit'), 0) AS returns
    FROM movements GROUP BY "customerId", "customerName"
    ORDER BY total DESC, "customerId" ASC`);
  return rows.map((row) => filter.excludeTax
    ? { ...row, total: Number(row.total), gross: Number(row.gross), returns: Number(row.returns) }
    : { customerId: row.customerId, customerName: row.customerName, invoiceCount: row.invoiceCount, total: Number(row.total) });
}

export async function readSalesHistory(db: Reader, filter: SalesSummaryFilter, limit: number) {
  const rows = await db.$queryRaw<Array<{ id: string; number: string; status: string; customerName: string;
    date: Date; kind: string; total: Prisma.Decimal }>>(Prisma.sql`
    WITH movements AS (${customerSalesMovements({ ...filter, excludeTax: true })})
    SELECT id, number, status, "customerName", date, kind, total FROM movements
    ORDER BY date DESC, number ASC, kind ASC LIMIT ${limit}`);
  return rows.map(row => ({ ...row, issueDate: row.date, totalAmount: Number(row.total) }));
}

/** Do not silently certify historical totals when old reversal data cannot be
 * assigned an unambiguous date. Return voids can have no journal at all. */
export async function readSalesWarnings(db: Reader, organizationId: string) {
  const rows = await db.$queryRaw<Array<{ kind: string; number: string }>>(Prisma.sql`
    SELECT 'invoice' AS kind, i.number FROM "SalesInvoice" i
    WHERE i."organizationId" = ${organizationId} AND i.status = 'VOID' AND
      (SELECT COUNT(DISTINCT j.date) FROM "JournalEntry" j WHERE j."organizationId" = i."organizationId"
        AND j.status = 'POSTED' AND j.source = 'REVERSAL' AND j.memo = 'Void invoice: ' || i.number) <> 1
    UNION ALL
    SELECT 'credit note', n.number FROM "CreditNote" n
    WHERE n."organizationId" = ${organizationId} AND n.status = 'VOID' AND
      (SELECT COUNT(*) FROM "JournalEntry" j WHERE j."organizationId" = n."organizationId"
        AND j.status = 'POSTED' AND j.source = 'REVERSAL' AND j.memo = 'Void credit note: ' || n.number) <> 1
    UNION ALL
    SELECT 'sales return', r.number FROM "SalesReturn" r
    WHERE r."organizationId" = ${organizationId} AND r.status = 'VOID' AND r."postedAt" IS NOT NULL
    UNION ALL
    SELECT 'sales return with missing source line', r.number FROM "SalesReturn" r
    WHERE r."organizationId" = ${organizationId} AND r."postedAt" IS NOT NULL AND r.status <> 'VOID'
      AND EXISTS (SELECT 1 FROM "SalesReturnLine" l LEFT JOIN "SalesInvoiceLine" source
        ON source.id = l."sourceInvoiceLineId" AND source."invoiceId" = r."invoiceId"
        WHERE l."salesReturnId" = r.id AND source.id IS NULL)
    UNION ALL
    SELECT 'credit note without a posting journal', n.number FROM "CreditNote" n
    WHERE n."organizationId" = ${organizationId} AND n.status = 'APPLIED' AND n."journalEntryId" IS NULL
    ORDER BY kind, number LIMIT 101`);
  const warnings = rows.slice(0, 100).map(row => `Sales report: ${row.kind} ${row.number} needs review; its posting, reversal date or item quantity cannot be confirmed.`);
  if (rows.length > 100) warnings.push('More historical reversals require review.');
  return warnings;
}

export async function readItemSales(db: Reader, filter: SalesSummaryFilter) {
  return readItemMovements(db, filter, false);
}

/** Allocate each financial document in cents. Standalone credits and invoice
 * charges remain visible in an unallocated row rather than being attributed
 * to arbitrary products. Quantities come from physical return documents, not
 * credit notes: one return may be settled by several partial notes. */
async function readItemMovements(db: Reader, filter: SalesSummaryFilter, byCustomer: boolean) {
  const date = (column: Prisma.Sql) => Prisma.sql`
    ${filter.dateFrom ? Prisma.sql`AND ${column} >= ${filter.dateFrom}` : Prisma.empty}
    ${filter.dateTo ? Prisma.sql`AND ${column} <= ${filter.dateTo}` : Prisma.empty}`;
  const rows = await db.$queryRaw<Array<{
    itemId: string | null; customerId: string | null; customerName: string | null;
    description: string; code: string | null; grossQty: Prisma.Decimal; returnedQty: Prisma.Decimal;
    gross: Prisma.Decimal; returns: Prisma.Decimal; qty: Prisma.Decimal; total: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH invoices AS (
      SELECT i.*, event.factor, c.name AS "customerName",
        ROUND((i.subtotal - i."discountAmount") /
          CASE WHEN i."taxEnabled" AND i."taxInclusive" THEN 1 + i."taxRate" / 100 ELSE 1 END, 2) AS "itemBase",
        i."totalAmount" - i."taxAmount" AS "netAmount"
      FROM "SalesInvoice" i JOIN "Customer" c ON c.id = i."customerId"
      ${invoiceEvents()}
      WHERE ${salesWhere({ ...filter, excludeTax: true })}
    ), invoice_lines AS (
      SELECT i.*, l.id AS "lineId", l."itemId", l.description, l.code, l.quantity,
        CASE WHEN MIN(l."lineSubtotal") OVER (PARTITION BY i.id, i.factor) < 0 THEN 0
          ELSE SUM(l."lineSubtotal") OVER (PARTITION BY i.id, i.factor) END AS weight,
        SUM(l."lineSubtotal") OVER (PARTITION BY i.id, i.factor ORDER BY l."lineNo", l.id) AS cumulative,
        l."lineSubtotal" AS part
      FROM invoices i JOIN "SalesInvoiceLine" l ON l."invoiceId" = i.id
    ), notes AS (
      SELECT n.*, event.factor, c.name AS "customerName", event.factor * (n.amount - CASE WHEN n."applyTax" THEN n."taxAmount" ELSE 0 END) AS net
      FROM "CreditNote" n JOIN "Customer" c ON c.id = n."customerId" AND c."organizationId" = n."organizationId"
      ${creditEvents()}
      WHERE n."organizationId" = ${filter.organizationId} ${date(Prisma.sql`event.date`)}
        ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c.name), lower(${filter.customerSearch})) > 0` : Prisma.empty}
        AND (n."sourceInvoiceId" IS NULL OR EXISTS (SELECT 1 FROM "SalesInvoice" s
          WHERE s.id = n."sourceInvoiceId" AND s."organizationId" = n."organizationId"
            AND s."customerId" = n."customerId" AND s.status IN ('SENT', 'OVERDUE', 'PAID', 'VOID')))
    ), note_lines AS (
      SELECT n.id AS "noteId", n.factor, n."customerId", n."customerName", n.net, l."itemId", l.description, l.code,
        r."lineTotal" AS part,
        SUM(r."lineTotal") OVER (PARTITION BY n.id, n.factor) AS weight,
        SUM(r."lineTotal") OVER (PARTITION BY n.id, n.factor ORDER BY r."lineNo", r.id) AS cumulative
      FROM notes n JOIN "SalesReturn" sr ON sr.id = n."salesReturnId" AND sr."organizationId" = n."organizationId"
        AND sr."customerId" = n."customerId" AND sr."invoiceId" = n."sourceInvoiceId"
      JOIN "SalesReturnLine" r ON r."salesReturnId" = sr.id
      JOIN "SalesInvoiceLine" l ON l.id = r."sourceInvoiceLineId" AND l."invoiceId" = sr."invoiceId"
      WHERE r."lineTotal" > 0 AND NOT EXISTS (
        SELECT 1 FROM "SalesReturnLine" bad
        LEFT JOIN "SalesInvoiceLine" source ON source.id = bad."sourceInvoiceLineId" AND source."invoiceId" = sr."invoiceId"
        WHERE bad."salesReturnId" = sr.id AND (source.id IS NULL OR bad."lineTotal" <= 0)
      )
    ), movements AS (
      SELECT "customerId", "customerName", "itemId", description, code, factor * quantity AS "grossQty", 0::numeric AS "returnedQty",
        CASE WHEN weight > 0 THEN factor * (ROUND("itemBase" * cumulative / weight, 2) - ROUND("itemBase" * (cumulative - part) / weight, 2)) ELSE 0 END AS gross,
        0::numeric AS returns FROM invoice_lines
      UNION ALL
      SELECT i."customerId", i."customerName", NULL, 'Unallocated invoice charges / adjustments', NULL, 0, 0,
        i.factor * (i."netAmount" - CASE WHEN EXISTS (SELECT 1 FROM invoice_lines l WHERE l.id = i.id AND l.factor = i.factor AND l.weight > 0) THEN i."itemBase" ELSE 0 END), 0
      FROM invoices i
      UNION ALL
      SELECT "customerId", "customerName", "itemId", description, code, 0, 0, 0,
        ROUND(net * cumulative / weight, 2) - ROUND(net * (cumulative - part) / weight, 2) FROM note_lines
      UNION ALL
      SELECT n."customerId", n."customerName", NULL, 'Unallocated credit notes', NULL, 0, 0, 0, n.net
      FROM notes n WHERE NOT EXISTS (SELECT 1 FROM note_lines l WHERE l."noteId" = n.id AND l.factor = n.factor)
      UNION ALL
      SELECT sr."customerId", c.name, l."itemId", l.description, l.code, 0, r."qtyReturn", 0, 0
      FROM "SalesReturn" sr JOIN "Customer" c ON c.id = sr."customerId" AND c."organizationId" = sr."organizationId"
      JOIN "SalesReturnLine" r ON r."salesReturnId" = sr.id
      JOIN "SalesInvoiceLine" l ON l.id = r."sourceInvoiceLineId" AND l."invoiceId" = sr."invoiceId"
      WHERE sr."organizationId" = ${filter.organizationId} AND sr."postedAt" IS NOT NULL
        AND sr.status IN ('APPROVED', 'PENDING_CREDIT_NOTE', 'APPLIED') ${date(Prisma.sql`sr."returnDate"`)}
        ${filter.customerSearch ? Prisma.sql`AND strpos(lower(c.name), lower(${filter.customerSearch})) > 0` : Prisma.empty}
    )
    SELECT ${byCustomer ? Prisma.sql`v."customerId", v."customerName"` : Prisma.sql`NULL::text AS "customerId", NULL::text AS "customerName"`},
      m.id AS "itemId", COALESCE(m.name, CASE WHEN m.id IS NULL THEN v.description END) AS description,
      COALESCE(m.sku, MIN(v.code)) AS code, SUM(v."grossQty") AS "grossQty", SUM(v."returnedQty") AS "returnedQty",
      SUM(v."grossQty" - v."returnedQty") AS qty, SUM(v.gross) AS gross, SUM(v.returns) AS returns,
      SUM(v.gross - v.returns) AS total
    FROM movements v LEFT JOIN "Item" m ON m.id = v."itemId" AND m."organizationId" = ${filter.organizationId}
    GROUP BY ${byCustomer ? Prisma.sql`v."customerId", v."customerName",` : Prisma.empty} m.id, m.name, m.sku,
      CASE WHEN m.id IS NULL THEN v.description END, CASE WHEN m.id IS NULL THEN v.code END
    HAVING SUM(ABS(v.gross) + ABS(v.returns) + ABS(v."grossQty") + ABS(v."returnedQty")) <> 0
    ORDER BY total DESC, description ASC`);
  return rows.map(row => ({ ...row, grossQty: Number(row.grossQty), returnedQty: Number(row.returnedQty),
    qty: Number(row.qty), gross: Number(row.gross), returns: Number(row.returns), total: Number(row.total) }));
}

export async function readTopProducts(db: Reader, filter: SalesSummaryFilter) {
  const rows = await readItemMovements(db, filter, false);
  return rows.filter(row => row.itemId !== null).map(row => ({ itemId: row.itemId, sku: row.code ?? '',
    name: row.description, qty: row.qty, total: row.total }));
}

export async function readItemCustomerSales(db: Reader, filter: SalesSummaryFilter) {
  return readItemMovements(db, filter, true);
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
