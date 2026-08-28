-- CreateTable
CREATE TABLE "FiscalYearClose" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "closingEntryId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,

    CONSTRAINT "FiscalYearClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYearClose_closingEntryId_key" ON "FiscalYearClose"("closingEntryId");

-- CreateIndex
CREATE INDEX "FiscalYearClose_organizationId_endDate_idx" ON "FiscalYearClose"("organizationId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYearClose_organizationId_startDate_key" ON "FiscalYearClose"("organizationId", "startDate");

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_closingEntryId_fkey" FOREIGN KEY ("closingEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

