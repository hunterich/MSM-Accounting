-- Candidates only: these rows require finance review, not automatic classification.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT p."organizationId", p."id" AS payment_id, p."number" AS payment_number,
       p."status", i."id" AS invoice_id, i."number" AS invoice_number,
       i."poNumber", c."id" AS possible_connection_id, c."shopName",
       'possible marketplace receipt, needs finance review' AS finding
FROM "ARPayment" p
JOIN "ARPaymentAllocation" a ON a."paymentId" = p."id"
JOIN "SalesInvoice" i ON i."id" = a."invoiceId" AND i."organizationId" = p."organizationId"
JOIN "EcommerceConnection" c ON c."organizationId" = p."organizationId" AND c."customerId" = i."customerId"
WHERE p."source" = 'MANUAL' AND NULLIF(TRIM(i."poNumber"), '') IS NOT NULL
ORDER BY p."organizationId", p."number", i."number", c."id";
ROLLBACK;
