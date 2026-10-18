-- Preserve receipt unit prices and legacy history. NULL means not initialized.
ALTER TABLE "InventoryLot" ADD COLUMN "initialValue" DECIMAL(18,2);
ALTER TABLE "InventoryLot" ADD COLUMN "carryingValue" DECIMAL(18,2);
ALTER TABLE "InventoryLotDraw" ADD COLUMN "costValue" DECIMAL(18,2);
