-- Voids now mark the rows they neutralise with "reversedAt" instead of linking
-- them through "reversesLedgerEntryId". Carry any existing links forward before
-- dropping the column, so no void recorded under the link loses its marking.

-- Removal row of an inbound void: it linked to the inbound it removed.
UPDATE "InventoryLedgerEntry"
SET "reversedAt" = "date"
WHERE "reversesLedgerEntryId" IS NOT NULL AND "qtyOut" > 0 AND "reversedAt" IS NULL;

-- Restore row of an outbound void: mark the outbound row it undid.
UPDATE "InventoryLedgerEntry" AS issued
SET "reversedAt" = restore."date"
FROM "InventoryLedgerEntry" AS restore
WHERE restore."reversesLedgerEntryId" = issued."id"
  AND restore."qtyIn" > 0 AND issued."qtyOut" > 0 AND issued."reversedAt" IS NULL;

DROP INDEX IF EXISTS "InventoryLedgerEntry_reversesLedgerEntryId_idx";
ALTER TABLE "InventoryLedgerEntry" DROP COLUMN "reversesLedgerEntryId";
