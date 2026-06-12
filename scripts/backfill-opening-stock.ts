/**
 * One-time backfill: post opening stock for items created before opening-stock
 * posting existed.
 *
 * For every item with `openingStock > 0` and no OPENING ledger entry, this
 * writes the opening cost layer and the DR Inventory / CR Opening Balance
 * Equity journal entry — bringing on-hand quantity, the inventory ledger, and
 * the balance sheet into agreement. Idempotent: re-running skips items that
 * already have an opening entry.
 *
 * Run:  npx tsx scripts/backfill-opening-stock.ts
 */
import { PrismaClient, InventoryDocumentType } from '@prisma/client';
import { postOpeningStockIfNeeded } from '../lib/inventory-opening';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, displayName: true } });
  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of orgs) {
    const items = await prisma.item.findMany({
      where: {
        organizationId: org.id,
        openingStock: { gt: 0 },
        type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
      },
      select: { id: true, sku: true },
    });

    if (items.length === 0) continue;
    console.log(`\n[${org.displayName}] ${items.length} item(s) with opening stock`);

    for (const item of items) {
      try {
        const before = await prisma.inventoryLedgerEntry.count({
          where: { itemId: item.id, documentType: InventoryDocumentType.OPENING },
        });
        await prisma.$transaction((tx) => postOpeningStockIfNeeded(tx, org.id, item.id, new Date()));
        const after = await prisma.inventoryLedgerEntry.count({
          where: { itemId: item.id, documentType: InventoryDocumentType.OPENING },
        });
        if (after > before) {
          posted += 1;
          console.log(`  ✓ posted opening for ${item.sku}`);
        } else {
          skipped += 1;
        }
      } catch (e) {
        failed += 1;
        console.error(`  ✗ FAILED ${item.sku}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\nDone. posted=${posted} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
