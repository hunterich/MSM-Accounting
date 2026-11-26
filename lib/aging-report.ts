import { Prisma } from '@prisma/client';
import { sqlUtcTimestamp } from './sql-timestamp';

type Kind = 'ar' | 'ap';
const { sql } = Prisma;

// Only fixed SQL fragments select the subledger. All request values are bound.
const ledgers = {
  ar: {
    parties: sql`"Customer"`, documents: sql`"SalesInvoice"`, partyKey: sql`"customerId"`,
    payments: sql`"ARPayment"`, allocations: sql`"ARPaymentAllocation"`, docKey: sql`"invoiceId"`,
    notes: sql`"CreditNote"`, sourceKey: sql`"sourceInvoiceId"`,
    statuses: sql`('SENT', 'OVERDUE', 'PAID', 'VOID')`, controlAmount: sql`l.credit`,
    documentLabel: 'invoice', paymentLabel: 'AR receipt', noteLabel: 'credit note',
    settlement: 'APPLY_TO_INVOICE', refund: 'REFUND', account: 'AR',
  },
  ap: {
    parties: sql`"Vendor"`, documents: sql`"Bill"`, partyKey: sql`"vendorId"`,
    payments: sql`"APPayment"`, allocations: sql`"APPaymentAllocation"`, docKey: sql`"billId"`,
    notes: sql`"DebitNote"`, sourceKey: sql`"sourceBillId"`,
    statuses: sql`('OPEN', 'PENDING', 'OVERDUE', 'PAID', 'VOID')`, controlAmount: sql`l.debit`,
    documentLabel: 'bill', paymentLabel: 'AP payment', noteLabel: 'debit note',
    settlement: 'APPLY_TO_BILL', refund: 'REFUND_FROM_VENDOR', account: 'AP',
  },
};

const buckets = [
  ['current', sql`days = 0`],
  ['d1To30', sql`days BETWEEN 1 AND 30`],
  ['d31To60', sql`days BETWEEN 31 AND 60`],
  ['d61To90', sql`days BETWEEN 61 AND 90`],
  ['d90Plus', sql`days > 90`],
] as const;

interface AgingOptions {
  organizationId: string;
  asOf: Date;
  partySearch: string;
  page: number;
  limit: number;
  exportAll?: boolean;
}

interface AgingRow {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  partyId: string;
  code: string | null;
  name: string;
  status: string;
  daysOverdue: number;
  originalAmount: number;
  clearedAmount: number;
  balance: number;
  current: number;
  d1To30: number;
  d31To60: number;
  d61To90: number;
  d90Plus: number;
}

interface AgingResult {
  rows: AgingRow[];
  summary: Record<(typeof buckets)[number][0] | 'totalOutstanding' | 'unappliedCredits' | 'netOutstanding', number>;
  warnings: string[];
  total: number;
}

export const AGING_EXPORT_LIMIT = 100_000;

/**
 * Calculate the aging snapshot in one statement so pagination, bucket totals,
 * and historical warnings all see the same data. The statement reports still
 * use the transaction-by-transaction history reader.
 */
export async function readAgingReport(db: Pick<Prisma.TransactionClient, '$queryRaw'>, kind: Kind, options: AgingOptions) {
  const l = ledgers[kind];
  const { organizationId, asOf, partySearch, page, limit, exportAll } = options;
  const cutoff = sqlUtcTimestamp(asOf);
  const [result] = await db.$queryRaw<AgingResult[]>(sql`
    WITH parties AS NOT MATERIALIZED (
      SELECT id, code, name, "openingBalance" AS opening
      FROM ${l.parties}
      WHERE "organizationId" = ${organizationId}
        ${partySearch ? sql`AND name ILIKE ${'%' + partySearch + '%'}` : Prisma.empty}
    ), reversals AS NOT MATERIALIZED (
      -- An invoice and its COGS can share a reversal memo. If their dates
      -- disagree, neither date is conclusive, even beyond the cutoff.
      -- The joins use a null memo key for non-voids and keep the status
      -- predicate so PostgreSQL can estimate how many rows need a lookup.
      SELECT memo, MIN(date) AS date, CASE WHEN MIN(date) = MAX(date) THEN 1 ELSE 2 END AS dates
      FROM "JournalEntry"
      WHERE "organizationId" = ${organizationId} AND status = 'POSTED' AND source = 'REVERSAL'
      GROUP BY memo
    ), documents AS (
      SELECT d.id, d.number, d.${l.partyKey} AS party_id, d.status::text AS status,
        d."issueDate" AS issue, d."dueDate" AS due, d."totalAmount" AS original,
        r.date AS reversal, r.dates AS reversal_dates
      FROM ${l.documents} d
      JOIN parties party ON party.id = d.${l.partyKey}
      LEFT JOIN reversals r ON d.status = 'VOID' AND r.memo = CASE WHEN d.status = 'VOID' THEN ${'Void ' + l.documentLabel + ': '} || d.number END
      WHERE d."organizationId" = ${organizationId} AND d."issueDate" <= ${cutoff}
        AND d.status IN ${l.statuses}
    ), payments AS (
      SELECT p.id, p.number, p.${l.partyKey} AS party_id, p."totalAmount" AS amount, j.id AS journal_id,
        p.status = 'VOID' AS voided, r.dates AS reversal_dates,
        (p.status <> 'VOID' OR r.date > ${cutoff}) AS active,
        (p."journalEntryId" IS NOT NULL OR p.status = 'COMPLETED')
          AND COALESCE(j.date, p.date) <= ${cutoff}
          AND (p.status <> 'VOID' OR r.dates = 1) AS effective
      FROM ${l.payments} p
      JOIN parties party ON party.id = p.${l.partyKey}
      LEFT JOIN "JournalEntry" j ON j.id = p."journalEntryId" AND j."organizationId" = ${organizationId} AND j.status = 'POSTED'
      LEFT JOIN reversals r ON p.status = 'VOID' AND r.memo = CASE WHEN p.status = 'VOID' THEN ${'Void ' + l.paymentLabel + ': '} || p.number END
      WHERE p."organizationId" = ${organizationId} AND p.date <= ${cutoff}
    ), allocations AS (
      SELECT a."paymentId" AS payment_id, a.${l.docKey} AS document_id, p.active,
        a."amountApplied" + a."discountAmount" AS cleared, a."discountAmount" - a."penaltyAmount" AS adjustment
      FROM ${l.allocations} a JOIN payments p ON p.id = a."paymentId" WHERE p.effective
    ), payment_totals AS (
      SELECT payment_id, SUM(cleared) AS cleared, SUM(adjustment) AS adjustment
      FROM allocations GROUP BY payment_id
    ), payment_checks AS (
      SELECT p.number, p.party_id, p.voided, p.journal_id, p.active, p.amount + COALESCE(a.adjustment, 0) AS expected,
        a.payment_id IS NULL AS missing_allocation, COALESCE(a.cleared, 0) AS cleared
      FROM payments p LEFT JOIN payment_totals a ON a.payment_id = p.id WHERE p.effective
    ), notes AS (
      SELECT n.number, n.${l.partyKey} AS party_id, n.${l.sourceKey} AS document_id, n.status::text AS status,
        n."settlementType"::text AS settlement, n.amount, j.id AS journal_id, COALESCE(j.date, n.date) AS posted,
        (n."journalEntryId" IS NOT NULL OR n.status = 'APPLIED') AS eligible,
        r.date AS reversal, r.dates AS reversal_dates
      FROM ${l.notes} n
      JOIN parties party ON party.id = n.${l.partyKey}
      LEFT JOIN "JournalEntry" j ON j.id = n."journalEntryId" AND j."organizationId" = ${organizationId} AND j.status = 'POSTED'
      LEFT JOIN reversals r ON n.status = 'VOID' AND r.memo = CASE WHEN n.status = 'VOID' THEN ${'Void ' + l.noteLabel + ': '} || n.number END
      WHERE n."organizationId" = ${organizationId} AND n.date <= ${cutoff}
    ), active_notes AS (
      SELECT * FROM notes WHERE eligible AND posted <= ${cutoff} AND settlement = ${l.settlement}
        AND (status <> 'VOID' OR (reversal_dates = 1 AND reversal > ${cutoff}))
    ), document_credits AS (
      SELECT document_id, SUM(amount) AS cleared FROM (
        SELECT document_id, cleared AS amount FROM allocations WHERE active
        UNION ALL
        SELECT document_id, amount FROM active_notes WHERE document_id IS NOT NULL
      ) movements GROUP BY document_id
    ), party_credits AS (
      SELECT party_id, SUM(amount) AS credit FROM (
        SELECT party_id, expected - cleared AS amount FROM payment_checks WHERE active AND expected <> cleared
        UNION ALL
        SELECT party_id, amount FROM active_notes WHERE document_id IS NULL
      ) movements GROUP BY party_id
    ), balances AS (
      SELECT d.id, d.number, d.party_id, d.status, d.issue, d.due, d.original,
        COALESCE(c.cleared, 0) AS cleared, d.original - COALESCE(c.cleared, 0) AS balance,
        GREATEST(0, ${cutoff}::date - d.due::date - (${cutoff}::time < d.due::time)::int) AS days
      FROM documents d LEFT JOIN document_credits c ON c.document_id = d.id
      WHERE d.status <> 'VOID' OR (d.reversal_dates = 1 AND d.reversal > ${cutoff})
      UNION ALL
      SELECT 'opening:' || p.id, 'Opening balance / unapplied credit', p.id, 'OPENING_BALANCE',
        ${cutoff}, NULL, p.opening, COALESCE(c.credit, 0), p.opening - COALESCE(c.credit, 0), 0
      FROM parties p LEFT JOIN party_credits c ON c.party_id = p.id
      WHERE p.opening <> 0 OR COALESCE(c.credit, 0) <> 0
    ), totals AS (
      SELECT COUNT(*) FILTER (WHERE balance > 0)::int AS total,
        COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) AS outstanding,
        -COALESCE(SUM(balance) FILTER (WHERE balance < 0), 0) AS credits,
        ${Prisma.join(buckets.map(([key, check]) =>
          sql`COALESCE(SUM(balance) FILTER (WHERE balance > 0 AND ${check}), 0) AS ${Prisma.raw('"' + key + '"')}`))}
      FROM balances
    ), page_rows AS (
      SELECT b.id, b.number,
        to_char(b.issue, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "issueDate",
        to_char(b.due, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "dueDate",
        b.party_id AS "partyId", NULLIF(p.code, '') AS code, COALESCE(NULLIF(p.name, ''), 'Unknown') AS name, b.status,
        b.days AS "daysOverdue", b.original AS "originalAmount", b.cleared AS "clearedAmount", b.balance,
        ${Prisma.join(buckets.map(([key, check]) =>
          sql`CASE WHEN ${check} THEN b.balance ELSE 0 END AS ${Prisma.raw('"' + key + '"')}`))}
      FROM balances b JOIN parties p ON p.id = b.party_id
      WHERE b.balance > 0 ${exportAll ? sql`AND (SELECT total FROM totals) <= ${AGING_EXPORT_LIMIT}` : Prisma.empty}
      ORDER BY b.days DESC, b.due NULLS LAST, p.name, b.issue, b.number, b.id
      LIMIT ${exportAll ? AGING_EXPORT_LIMIT : limit} OFFSET ${exportAll ? 0 : (page - 1) * limit}
    ), warnings AS (
      SELECT 'Historical reversal ' || CASE WHEN reversal_dates > 1 THEN 'date is ambiguous' ELSE 'unavailable' END
        || ' for voided ' || label || ' ' || number || '; past balances cannot be confirmed' AS warning
      FROM (
        SELECT reversal_dates, number, ${l.documentLabel} AS label FROM documents WHERE status = 'VOID'
        UNION ALL SELECT reversal_dates, number, ${l.paymentLabel} FROM payments WHERE voided
        UNION ALL SELECT reversal_dates, number, ${l.noteLabel} FROM notes WHERE status = 'VOID'
      ) candidates WHERE reversal_dates IS DISTINCT FROM 1
      UNION ALL
      -- Only a mismatch on the first settlement line produces a warning.
      -- Look for an earlier line only when a candidate actually differs.
      SELECT 'Payment ' || p.number || ' journal and settlement adjustments differ; review the original posting'
      FROM payment_checks p JOIN "JournalLine" l ON l."entryId" = p.journal_id
      WHERE l.description LIKE ${l.account + ' settlement - %'} AND CASE WHEN ${l.controlAmount} <> p.expected THEN
        NOT EXISTS (
          SELECT 1 FROM "JournalLine" earlier WHERE earlier."entryId" = l."entryId"
            AND earlier."lineNo" < l."lineNo" AND earlier.description LIKE ${l.account + ' settlement - %'}
        ) ELSE false END
      UNION ALL
      SELECT 'Historical allocation unavailable for voided payment ' || number
      FROM payment_checks WHERE voided AND active AND missing_allocation
      UNION ALL
      SELECT 'Refund ' || n.number || ' was posted to ' || ${l.account} || ' instead of cash; review and reverse/reissue the original posting'
      FROM notes n
      WHERE n.settlement = ${l.refund} AND (n.status <> 'VOID' OR n.reversal_dates = 1)
        AND EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId" = n.journal_id AND l.description LIKE ${l.account + ' reduction - %'})
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."daysOverdue" DESC, p."dueDate" NULLS LAST, p.name, p."issueDate", p.number, p.id) FROM page_rows p), '[]') AS rows,
      (to_jsonb(t) - ARRAY['total', 'outstanding', 'credits']) || jsonb_build_object(
        'totalOutstanding', t.outstanding, 'unappliedCredits', t.credits, 'netOutstanding', t.outstanding - t.credits
      ) AS summary,
      COALESCE((SELECT jsonb_agg(warning ORDER BY warning) FROM warnings), '[]') AS warnings, t.total
    FROM totals t
  `);

  const rows = result.rows.map(({ id, number, issueDate, partyId, code, name, ...row }) => ({
    ...row,
    ...(kind === 'ar'
      ? { invoiceId: id, invoiceNumber: number, invoiceDate: issueDate, customerId: partyId, customerCode: code, customerName: name }
      : { billId: id, billNumber: number, billDate: issueDate, vendorId: partyId, vendorName: name }),
  }));
  return { ...result, rows, page: exportAll ? 1 : page, limit: exportAll ? AGING_EXPORT_LIMIT : limit };
}
