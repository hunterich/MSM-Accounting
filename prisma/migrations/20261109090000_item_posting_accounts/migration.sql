-- Existing rows remain NULL: historical posting accounts must not be guessed.
ALTER TABLE "SalesInvoiceLine"
  ADD COLUMN "revenuePostingAccountId" TEXT,
  ADD COLUMN "inventoryPostingAccountId" TEXT,
  ADD COLUMN "cogsPostingAccountId" TEXT;
