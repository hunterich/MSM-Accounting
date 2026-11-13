-- Pre-release audit only. No document, status, stock or journal writes.
--
-- Auto-close now counts from the PO date (or the reopen date) instead of the
-- expected delivery date. Run this on each production database BEFORE
-- deploying, to list open orders whose deadline moves. Rows with
-- closes_on_first_sweep = true close within 15 minutes of the deploy; review
-- them with the business first and, where needed, turn auto-close off or
-- change the day count on those orders.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH open_orders AS (
  SELECT po."organizationId", o."name" AS company, po."number", po."status"::text AS status,
         po."date"::date AS po_date, po."expectedDate"::date AS expected_date, po."autoCloseDays",
         (now() AT TIME ZONE coalesce(nullif(o."timezone", ''), 'Asia/Jakarta'))::date AS company_today
  FROM "PurchaseOrder" po
  JOIN "Organization" o ON o."id" = po."organizationId"
  WHERE po."autoCloseEnabled" AND po."status"::text IN ('APPROVED', 'PARTIAL_RECEIVED')
)
SELECT company, "number", status, po_date, expected_date, "autoCloseDays",
       expected_date + "autoCloseDays" AS old_deadline,
       po_date + "autoCloseDays" AS new_deadline,
       company_today >= po_date + "autoCloseDays" AS closes_on_first_sweep
FROM open_orders
WHERE (expected_date + "autoCloseDays") IS DISTINCT FROM (po_date + "autoCloseDays")
ORDER BY closes_on_first_sweep DESC, company, new_deadline, "number";

ROLLBACK;
