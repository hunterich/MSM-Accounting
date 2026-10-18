-- Links each void's compensating stock row to the movement it reverses, so a
-- Weighted Average inbound void can ignore issues that no longer affect the pool.
-- Only future voids are linked; legacy rows stay NULL and keep blocking.
ALTER TABLE "InventoryLedgerEntry" ADD COLUMN "reversesLedgerEntryId" TEXT;
CREATE INDEX "InventoryLedgerEntry_reversesLedgerEntryId_idx" ON "InventoryLedgerEntry"("reversesLedgerEntryId");
