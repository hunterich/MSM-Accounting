ALTER TABLE "Organization" ADD COLUMN "purchasePolicy" JSONB;
-- Existing orders stay open; new orders copy the organization's defaults.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "autoCloseEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoCloseDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "autoClosedAt" TIMESTAMP(3);
CREATE INDEX "PurchaseOrder_autoCloseEnabled_status_expectedDate_idx"
  ON "PurchaseOrder"("autoCloseEnabled", "status", "expectedDate");
