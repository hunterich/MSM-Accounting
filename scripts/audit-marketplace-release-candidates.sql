-- Candidates for human review only. Run against an approved read-only replica
-- or restored copy. The database cannot establish the actual dispatch date;
-- compare each candidate with the original full marketplace export.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

SELECT DISTINCT i."organizationId", p."ecommerceConnectionId", i."id" AS invoice_id,
       i."number" AS invoice_number, i."poNumber", i."issueDate", i."shippingDate",
       p."id" AS receipt_id, p."date" AS receipt_date, p."source"
FROM "SalesInvoice" i
JOIN "ARPaymentAllocation" a ON a."invoiceId" = i."id"
JOIN "ARPayment" p ON p."id" = a."paymentId" AND p."organizationId" = i."organizationId"
WHERE p."source" = 'MARKETPLACE_IMPORT'
ORDER BY i."organizationId", i."issueDate", i."number";

-- Legacy settlement lines explicitly labelled refund, with notes for the same
-- invoice. Amount or timing alone does not prove duplication; also inspect
-- statement, full journals, account mapping and original return documents.
-- Refunds hidden in adjustment lines will not be found by this query.
SELECT p."organizationId", p."ecommerceConnectionId", i."id" AS invoice_id,
       i."number" AS invoice_number, i."poNumber", p."id" AS receipt_id,
       j."id" AS settlement_journal_id, j."date" AS settlement_date,
       l."id" AS legacy_line_id, l."accountId", l."debit", l."credit",
       n."id" AS credit_note_id, n."number" AS credit_note_number,
       n."date" AS credit_note_date, n."amount", n."status"
FROM "ARPayment" p
JOIN "ARPaymentAllocation" a ON a."paymentId" = p."id"
JOIN "SalesInvoice" i ON i."id" = a."invoiceId" AND i."organizationId" = p."organizationId"
JOIN "JournalEntry" j ON j."id" = p."settlementJournalId" AND j."organizationId" = p."organizationId"
JOIN "JournalLine" l ON l."entryId" = j."id" AND l."description" ILIKE 'refund - %'
JOIN "CreditNote" n ON n."sourceInvoiceId" = i."id" AND n."organizationId" = p."organizationId"
WHERE n."status" = 'APPLIED'
ORDER BY p."organizationId", i."number", j."date", n."date";
ROLLBACK;
