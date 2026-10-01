ALTER TABLE "Asset" ADD COLUMN "readyForUseDate" TIMESTAMP(3);
ALTER TABLE "BillLine" ADD COLUMN "assetId" TEXT;
CREATE UNIQUE INDEX "BillLine_assetId_key" ON "BillLine"("assetId");
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
