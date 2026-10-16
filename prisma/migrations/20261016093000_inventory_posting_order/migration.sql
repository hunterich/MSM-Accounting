-- Only future postings receive an order. Legacy transaction chronology cannot
-- safely be fabricated from document dates or transaction-start timestamps.
CREATE SEQUENCE "InventoryLedgerEntry_postingSequence_seq" AS INTEGER;
ALTER TABLE "InventoryLedgerEntry" ADD COLUMN "postingSequence" INTEGER;
ALTER TABLE "InventoryLedgerEntry" ALTER COLUMN "postingSequence" SET DEFAULT nextval('"InventoryLedgerEntry_postingSequence_seq"');
ALTER SEQUENCE "InventoryLedgerEntry_postingSequence_seq" OWNED BY "InventoryLedgerEntry"."postingSequence";
CREATE UNIQUE INDEX "InventoryLedgerEntry_postingSequence_key" ON "InventoryLedgerEntry"("postingSequence");
ALTER TABLE "InventoryLot" ADD COLUMN "inboundLedgerEntryId" TEXT;
CREATE INDEX "InventoryLot_inboundLedgerEntryId_idx" ON "InventoryLot"("inboundLedgerEntryId");
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_inboundLedgerEntryId_fkey" FOREIGN KEY ("inboundLedgerEntryId") REFERENCES "InventoryLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
