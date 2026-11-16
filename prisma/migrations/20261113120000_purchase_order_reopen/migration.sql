-- Reopening a closed purchase order restarts its auto-close period from the
-- reopen date. Existing orders have never been reopened, so the column stays
-- NULL and their deadline counts from the PO date.
ALTER TABLE "PurchaseOrder" ADD COLUMN "reopenedAt" TIMESTAMP(3);
