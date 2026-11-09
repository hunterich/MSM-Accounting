-- Existing history stays NULL; no item setting is used to infer past postings.
ALTER TABLE "InventoryLedgerEntry" ADD COLUMN "inventoryPostingAccountId" TEXT;
