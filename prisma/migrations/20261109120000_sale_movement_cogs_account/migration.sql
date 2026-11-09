-- Existing movements retain unknown account history; no backfill.
ALTER TABLE "InventoryLedgerEntry" ADD COLUMN "cogsPostingAccountId" TEXT;
