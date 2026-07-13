-- CreateEnum
CREATE TYPE "MigrationBatchStatus" AS ENUM ('DRAFT', 'COMMITTED', 'ROLLED_BACK');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "InventoryLedgerEntry" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "InventoryLot" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "migrationBatchId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "migrationBatchId" TEXT;

-- CreateTable
CREATE TABLE "MigrationBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cutoverDate" TIMESTAMP(3) NOT NULL,
    "status" "MigrationBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "stagedData" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationBatch_organizationId_status_idx" ON "MigrationBatch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Account_migrationBatchId_idx" ON "Account"("migrationBatchId");

-- CreateIndex
CREATE INDEX "Bill_migrationBatchId_idx" ON "Bill"("migrationBatchId");

-- CreateIndex
CREATE INDEX "Customer_migrationBatchId_idx" ON "Customer"("migrationBatchId");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_migrationBatchId_idx" ON "InventoryLedgerEntry"("migrationBatchId");

-- CreateIndex
CREATE INDEX "InventoryLot_migrationBatchId_idx" ON "InventoryLot"("migrationBatchId");

-- CreateIndex
CREATE INDEX "Item_migrationBatchId_idx" ON "Item"("migrationBatchId");

-- CreateIndex
CREATE INDEX "JournalEntry_migrationBatchId_idx" ON "JournalEntry"("migrationBatchId");

-- CreateIndex
CREATE INDEX "SalesInvoice_migrationBatchId_idx" ON "SalesInvoice"("migrationBatchId");

-- CreateIndex
CREATE INDEX "Vendor_migrationBatchId_idx" ON "Vendor"("migrationBatchId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationBatch" ADD CONSTRAINT "MigrationBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationBatch" ADD CONSTRAINT "MigrationBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_migrationBatchId_fkey" FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

