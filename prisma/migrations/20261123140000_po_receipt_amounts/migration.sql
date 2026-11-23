ALTER TABLE "PurchaseOrderLine" ADD COLUMN "taxable" BOOLEAN;
ALTER TABLE "BillLine" ADD COLUMN "poReceiptTaxAmount" DECIMAL(18,2);
ALTER TABLE "InventoryLot" ADD COLUMN "poReceipt" BOOLEAN NOT NULL DEFAULT false;
