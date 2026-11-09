-- Historical settlements retain unknown account history.
ALTER TABLE "InventoryShortfallSettlement"
  ADD COLUMN "inventoryPostingAccountId" TEXT,
  ADD COLUMN "cogsPostingAccountId" TEXT;
