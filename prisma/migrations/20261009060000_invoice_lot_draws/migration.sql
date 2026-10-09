ALTER TABLE "SalesInvoice" ADD COLUMN "postingTracked" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "postingJournalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "InventoryLedgerEntry" ADD COLUMN "drawsTracked" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "reversedAt" TIMESTAMP(3);
CREATE TABLE "InventoryLotDraw" (
    "id" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(15,4) NOT NULL,
    CONSTRAINT "InventoryLotDraw_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryLotDraw_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "InventoryLotDraw_ledgerEntryId_idx" ON "InventoryLotDraw"("ledgerEntryId");
CREATE INDEX "InventoryLotDraw_lotId_idx" ON "InventoryLotDraw"("lotId");
ALTER TABLE "InventoryLotDraw" ADD CONSTRAINT "InventoryLotDraw_ledgerEntryId_fkey"
    FOREIGN KEY ("ledgerEntryId") REFERENCES "InventoryLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLotDraw" ADD CONSTRAINT "InventoryLotDraw_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
