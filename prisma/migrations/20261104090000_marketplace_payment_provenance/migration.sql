CREATE TYPE "ARPaymentSource" AS ENUM ('MANUAL', 'MARKETPLACE_IMPORT');
ALTER TABLE "ARPayment" ADD COLUMN "source" "ARPaymentSource" NOT NULL DEFAULT 'MANUAL', ADD COLUMN "ecommerceConnectionId" TEXT, ADD COLUMN "marketplaceOrderNo" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "marketplaceOverrideReason" TEXT;
CREATE INDEX "ARPayment_ecommerceConnectionId_idx" ON "ARPayment"("ecommerceConnectionId");
ALTER TABLE "ARPayment" ADD CONSTRAINT "ARPayment_ecommerceConnectionId_fkey" FOREIGN KEY ("ecommerceConnectionId") REFERENCES "EcommerceConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
