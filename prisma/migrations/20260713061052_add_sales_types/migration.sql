-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('OFFLINE', 'ONLINE');

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "salesTypeId" TEXT;

-- AlterTable
ALTER TABLE "EcommerceConnection" ADD COLUMN     "salesTypeId" TEXT;

-- AlterTable
ALTER TABLE "PosRegister" ADD COLUMN     "defaultSalesTypeId" TEXT;

-- CreateTable
CREATE TABLE "SalesType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL DEFAULT 'OFFLINE',
    "serviceChargePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "chargeAccountId" TEXT,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesType_organizationId_idx" ON "SalesType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesType_organizationId_name_key" ON "SalesType"("organizationId", "name");

-- CreateIndex
CREATE INDEX "SalesInvoice_salesTypeId_idx" ON "SalesInvoice"("salesTypeId");

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_salesTypeId_fkey" FOREIGN KEY ("salesTypeId") REFERENCES "SalesType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceConnection" ADD CONSTRAINT "EcommerceConnection_salesTypeId_fkey" FOREIGN KEY ("salesTypeId") REFERENCES "SalesType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_defaultSalesTypeId_fkey" FOREIGN KEY ("defaultSalesTypeId") REFERENCES "SalesType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesType" ADD CONSTRAINT "SalesType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesType" ADD CONSTRAINT "SalesType_chargeAccountId_fkey" FOREIGN KEY ("chargeAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

