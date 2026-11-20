ALTER TABLE "CreditNote"
  ADD COLUMN "marketplaceRefundReceiptId" TEXT,
  ADD COLUMN "marketplaceRefundReconciledAt" TIMESTAMP(3);

CREATE INDEX "CreditNote_marketplaceRefundReceiptId_idx" ON "CreditNote"("marketplaceRefundReceiptId");
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_marketplaceRefundReceiptId_fkey"
  FOREIGN KEY ("marketplaceRefundReceiptId") REFERENCES "ARPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EcommerceConnection" ALTER COLUMN "importStatusFilter" SET DEFAULT 'Shipped';
