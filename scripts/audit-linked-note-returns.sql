-- Pre-release audit only. No document, status, stock or journal writes.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH linked AS (
  SELECT 'CREDIT_NOTE' AS kind, n."id", n."number", n."organizationId",
         n."status"::text AS status, n."salesReturnId" AS return_id,
         array_remove(ARRAY[
           CASE WHEN r."id" IS NULL THEN 'RETURN_MISSING' END,
           CASE WHEN r."id" IS NOT NULL AND r."organizationId" IS DISTINCT FROM n."organizationId" THEN 'COMPANY_MISMATCH' END,
           CASE WHEN r."id" IS NOT NULL AND r."customerId" IS DISTINCT FROM n."customerId" THEN 'CUSTOMER_MISMATCH' END,
           CASE WHEN r."id" IS NOT NULL AND r."invoiceId" IS DISTINCT FROM n."sourceInvoiceId" THEN 'SOURCE_INVOICE_MISSING_OR_MISMATCHED' END,
           CASE WHEN r."status"::text IN ('DRAFT', 'VOID') THEN 'RETURN_' || r."status"::text END
         ], NULL) AS reasons
  FROM "CreditNote" n LEFT JOIN "SalesReturn" r ON r."id" = n."salesReturnId"
  WHERE n."salesReturnId" IS NOT NULL AND n."status"::text IN ('DRAFT', 'PENDING_APPROVAL')
  UNION ALL
  SELECT 'DEBIT_NOTE', n."id", n."number", n."organizationId",
         n."status"::text, n."purchaseReturnId",
         array_remove(ARRAY[
           CASE WHEN r."id" IS NULL THEN 'RETURN_MISSING' END,
           CASE WHEN r."id" IS NOT NULL AND r."organizationId" IS DISTINCT FROM n."organizationId" THEN 'COMPANY_MISMATCH' END,
           CASE WHEN r."id" IS NOT NULL AND r."vendorId" IS DISTINCT FROM n."vendorId" THEN 'VENDOR_MISMATCH' END,
           CASE WHEN r."id" IS NOT NULL AND r."billId" IS DISTINCT FROM n."sourceBillId" THEN 'SOURCE_BILL_MISSING_OR_MISMATCHED' END,
           CASE WHEN r."status"::text IN ('DRAFT', 'VOID') THEN 'RETURN_' || r."status"::text END
         ], NULL)
  FROM "DebitNote" n LEFT JOIN "PurchaseReturn" r ON r."id" = n."purchaseReturnId"
  WHERE n."purchaseReturnId" IS NOT NULL AND n."status"::text IN ('DRAFT', 'PENDING_APPROVAL')
), invalid AS (
  SELECT * FROM linked WHERE cardinality(reasons) > 0
), detail AS (
  SELECT * FROM invalid ORDER BY "organizationId", kind, "number", "id" LIMIT 200
)
SELECT jsonb_pretty(jsonb_build_object(
  'database', current_database(),
  'checked_at', transaction_timestamp(),
  'linked_draft_or_pending_count', (SELECT count(*) FROM linked),
  'invalid_count', (SELECT count(*) FROM invalid),
  'invalid_pending_count', (SELECT count(*) FROM invalid WHERE status = 'PENDING_APPROVAL'),
  'details_limit', 200,
  'details', COALESCE((SELECT jsonb_agg(to_jsonb(detail)) FROM detail), '[]'::jsonb)
));

ROLLBACK;
