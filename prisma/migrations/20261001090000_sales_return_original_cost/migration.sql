-- Costs are captured only when a sale posts. Historical invoices retain NULL
-- until a return can recover an unambiguous cost from the outbound ledger.
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "cogsAmount" DECIMAL(18,2);
ALTER TABLE "SalesReturnLine"
  ADD COLUMN "sourceInvoiceLineId" TEXT,
  ADD COLUMN "goodsReceived" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inventoryCost" DECIMAL(18,2);

CREATE INDEX "SalesReturnLine_sourceInvoiceLineId_idx" ON "SalesReturnLine"("sourceInvoiceLineId");
ALTER TABLE "SalesReturnLine" ADD CONSTRAINT "SalesReturnLine_sourceInvoiceLineId_fkey"
  FOREIGN KEY ("sourceInvoiceLineId") REFERENCES "SalesInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match InventoryLot precision so fractional original-sale unit costs survive
-- ledger round-trips rather than being rounded to whole cents per unit.
ALTER TABLE "InventoryLedgerEntry" ALTER COLUMN "unitCost" TYPE DECIMAL(18,6);
