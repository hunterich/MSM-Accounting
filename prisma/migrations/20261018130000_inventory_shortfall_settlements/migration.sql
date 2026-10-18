-- Finance-approved Weighted Average negative stock (2026-10-15): a shortage sale
-- keeps its estimated cost; a later receipt in the same warehouse settles the
-- covered quantity and posts the cost difference on the receipt date.
-- Only future shortage draws are flagged. Existing negative pools are not
-- backfilled: their estimates cannot be reconstructed and need read-only review.
ALTER TYPE "InventoryDocumentType" ADD VALUE 'SHORTFALL_SETTLEMENT';

ALTER TABLE "InventoryLotDraw" ADD COLUMN "shortfall" BOOLEAN NOT NULL DEFAULT false;

CREATE SEQUENCE "InventoryShortfallSettlement_settlementSequence_seq" AS INTEGER;
CREATE TABLE "InventoryShortfallSettlement" (
    "id" TEXT NOT NULL,
    "settlementSequence" INTEGER NOT NULL DEFAULT nextval('"InventoryShortfallSettlement_settlementSequence_seq"'),
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "saleDrawId" TEXT NOT NULL,
    "saleLedgerEntryId" TEXT NOT NULL,
    "receiptLedgerEntryId" TEXT NOT NULL,
    "receiptLotId" TEXT,
    "adjustmentLedgerEntryId" TEXT,
    "journalEntryId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "estimatedValue" DECIMAL(18,2) NOT NULL,
    "actualValue" DECIMAL(18,2) NOT NULL,
    "cogsAdjustment" DECIMAL(18,2) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalLedgerEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryShortfallSettlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryShortfallSettlement_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "InventoryShortfallSettlement_value_check" CHECK ("estimatedValue" >= 0 AND "actualValue" >= 0
        AND "cogsAdjustment" = "actualValue" - "estimatedValue")
);
ALTER SEQUENCE "InventoryShortfallSettlement_settlementSequence_seq" OWNED BY "InventoryShortfallSettlement"."settlementSequence";
CREATE UNIQUE INDEX "InventoryShortfallSettlement_settlementSequence_key" ON "InventoryShortfallSettlement"("settlementSequence");
CREATE INDEX "InventoryShortfallSettlement_organizationId_itemId_warehouseId_idx" ON "InventoryShortfallSettlement"("organizationId", "itemId", "warehouseId");
CREATE INDEX "InventoryShortfallSettlement_saleDrawId_idx" ON "InventoryShortfallSettlement"("saleDrawId");
CREATE INDEX "InventoryShortfallSettlement_receiptLedgerEntryId_idx" ON "InventoryShortfallSettlement"("receiptLedgerEntryId");
CREATE INDEX "InventoryShortfallSettlement_receiptLotId_idx" ON "InventoryShortfallSettlement"("receiptLotId");
ALTER TABLE "InventoryShortfallSettlement" ADD CONSTRAINT "InventoryShortfallSettlement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryShortfallSettlement" ADD CONSTRAINT "InventoryShortfallSettlement_saleDrawId_fkey"
    FOREIGN KEY ("saleDrawId") REFERENCES "InventoryLotDraw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryShortfallSettlement" ADD CONSTRAINT "InventoryShortfallSettlement_receiptLotId_fkey"
    FOREIGN KEY ("receiptLotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
