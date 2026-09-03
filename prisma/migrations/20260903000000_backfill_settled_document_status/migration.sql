-- Backfill: documents that were already fully settled before the status
-- roll-up existed (lib/settlement-status.ts). Outstanding balances were always
-- derived from allocations, but nothing wrote PAID back to the invoice/bill,
-- so settled documents still read SENT / OPEN. Same rule as the runtime sync:
-- only COMPLETED payments clear a document, cash discount clears alongside
-- the cash applied, to the cent. Zero-total documents are left alone.

UPDATE "SalesInvoice" i
SET "status" = 'PAID', "updatedAt" = NOW()
WHERE i."status" IN ('SENT', 'OVERDUE')
  AND i."totalAmount" > 0
  AND i."totalAmount" - 0.01 <= COALESCE((
    SELECT SUM(a."amountApplied" + a."discountAmount")
    FROM "ARPaymentAllocation" a
    JOIN "ARPayment" p ON p."id" = a."paymentId"
    WHERE a."invoiceId" = i."id" AND p."status" = 'COMPLETED'
  ), 0);

UPDATE "Bill" b
SET "status" = 'PAID', "updatedAt" = NOW()
WHERE b."status" IN ('OPEN', 'PENDING', 'OVERDUE')
  AND b."totalAmount" > 0
  AND b."totalAmount" - 0.01 <= COALESCE((
    SELECT SUM(a."amountApplied" + a."discountAmount")
    FROM "APPaymentAllocation" a
    JOIN "APPayment" p ON p."id" = a."paymentId"
    WHERE a."billId" = b."id" AND p."status" = 'COMPLETED'
  ), 0);
