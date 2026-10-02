/** Opt-in database benchmark. Never accepts a production database name.
 * CAPACITY_DATABASE_URL must point to an already migrated *_capacity_test DB.
 * Seeds one isolated organization; removes only that organization's fixture.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { readJournalTotals } from '../lib/journal-totals';
import { computeLedgerValuation } from '../lib/inventory-valuation';
import { readCustomerSales, readTopProducts, readSalesCalendar } from '../lib/sales-summary';
import { buildTrialBalanceReport } from '../lib/gl-reporting';

const databaseUrl = process.env.CAPACITY_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_capacity_test')) {
  throw new Error('Set CAPACITY_DATABASE_URL to an already migrated database ending in _capacity_test. No database was changed.');
}
const orders = Number(process.env.CAPACITY_ORDERS ?? 350000);
if (!Number.isSafeInteger(orders) || orders < 350000 || orders > 2000000 || orders % 100 !== 0) {
  throw new Error('CAPACITY_ORDERS must be a multiple of 100 between 350000 and 2000000.');
}
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let orgId: string | undefined;
const metrics: Array<{ name: string; samplesMs: number[]; p95Ms: number; targetMs: number }> = [];
const measure = async (name: string, targetMs: number, work: () => Promise<void>) => {
  await work(); // warm up; cold-cache behavior needs separate deployment testing
  const samplesMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await work();
    samplesMs.push(Math.round((performance.now() - start) * 100) / 100);
  }
  const p95Ms = [...samplesMs].sort((a, b) => a - b)[4];
  metrics.push({ name, samplesMs, p95Ms, targetMs });
  console.log(`${name}: warm p95 ${p95Ms} ms (target ${targetMs} ms)`);
};

try {
  const org = await db.organization.create({ data: { legalName: 'Capacity benchmark fixture', displayName: 'Capacity benchmark fixture' } });
  orgId = org.id;
  const customers = await Promise.all(['Shopee', 'TikTok'].map((name) => db.customer.create({
    data: { organizationId: org.id, code: name, name },
  })));
  await db.item.createMany({ data: Array.from({ length: 100 }, (_, i) => ({
    id: `${org.id}-item-${i}`, organizationId: org.id, sku: `BENCH-${i}`, name: `Benchmark product ${i}`,
  })) });
  const accounts = await Promise.all([
    { code: '1200', name: 'AR', type: 'ASSET' as const, normalSide: 'DEBIT' as const },
    { code: '1300', name: 'Inventory', type: 'ASSET' as const, normalSide: 'DEBIT' as const },
    { code: '3900', name: 'Opening equity', type: 'EQUITY' as const, normalSide: 'CREDIT' as const },
    { code: '4000', name: 'Sales', type: 'REVENUE' as const, normalSide: 'CREDIT' as const },
    { code: '5000', name: 'COGS', type: 'EXPENSE' as const, normalSide: 'DEBIT' as const },
  ].map((a) => db.account.create({ data: { ...a, organizationId: org.id, isPostable: true } })));
  const [ar, inventory, equity, sales, cogs] = accounts;
  const invoicePrefix = `${org.id}-invoice-`;
  const journalPrefix = `${org.id}-journal-`;
  const itemPrefix = `${org.id}-item-`;
  console.log(`Seeding ${orders.toLocaleString()} orders / ${(orders * 10 + 103).toLocaleString()} transaction-table rows in an isolated test organization...`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "SalesInvoice" (id, "organizationId", number, "customerId", "issueDate", status, subtotal, "totalAmount", "createdAt", "updatedAt")
    SELECT ${invoicePrefix} || g, ${org.id}, 'BENCH-' || g,
      CASE WHEN g % 2 = 0 THEN ${customers[0].id} ELSE ${customers[1].id} END,
      timestamp '2025-01-01 00:00:00' + ((g - 1) % 365) * interval '1 day',
      'SENT'::"InvoiceStatus", 2000, 2000, now(), now()
    FROM generate_series(1, ${orders}::int) g`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "SalesInvoiceLine" (id, "invoiceId", "lineNo", "itemId", code, description, quantity, price, "lineSubtotal")
    SELECT ${invoicePrefix} || g || '-line-' || n, ${invoicePrefix} || g, n,
      ${itemPrefix} || (g % 100), 'BENCH-' || (g % 100), 'Benchmark product ' || (g % 100), 1, 1000, 1000
    FROM generate_series(1, ${orders}::int) g CROSS JOIN generate_series(1, 2) n`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "JournalEntry" (id, "organizationId", "entryNo", date, memo, status, "totalDebit", "totalCredit", "createdAt", "updatedAt")
    SELECT ${journalPrefix} || g, ${org.id}, 'BENCH-' || g,
      timestamp '2025-01-01 00:00:00' + ((g - 1) % 365) * interval '1 day',
      'Synthetic order', 'POSTED'::"JournalStatus", 3200, 3200, now(), now()
    FROM generate_series(1, ${orders}::int) g`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "JournalLine" (id, "entryId", "lineNo", "accountId", debit, credit)
    SELECT ${journalPrefix} || g || '-line-' || l.n, ${journalPrefix} || g, l.n, l.account, l.debit, l.credit
    FROM generate_series(1, ${orders}::int) g
    CROSS JOIN (VALUES (1, ${ar.id}::text, 2000, 0), (2, ${sales.id}::text, 0, 2000),
      (3, ${cogs.id}::text, 1200, 0), (4, ${inventory.id}::text, 0, 1200)) l(n, account, debit, credit)`);
  const opening = await db.journalEntry.create({ data: {
    organizationId: org.id, entryNo: 'BENCH-OPENING', date: new Date('2024-12-31T00:00:00Z'),
    memo: 'Initial benchmark stock', status: 'POSTED', totalDebit: orders * 1200, totalCredit: orders * 1200,
    lines: { create: [
      { lineNo: 1, accountId: inventory.id, debit: orders * 1200 },
      { lineNo: 2, accountId: equity.id, credit: orders * 1200 },
    ] },
  } });
  await db.inventoryLedgerEntry.createMany({ data: Array.from({ length: 100 }, (_, i) => ({
    organizationId: org.id, itemId: `${itemPrefix}${i}`, date: opening.date, documentType: 'OPENING' as const,
    documentId: opening.id, qtyIn: orders / 100 * 2, unitCost: 600, valueChange: orders / 100 * 1200,
  })) });
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "InventoryLedgerEntry" (id, "organizationId", "itemId", date, "documentType", "documentId", "qtyOut", "unitCost", "valueChange")
    SELECT ${invoicePrefix} || g || '-stock-' || n, ${org.id}, ${itemPrefix} || (g % 100),
      timestamp '2025-01-01 00:00:00' + ((g - 1) % 365) * interval '1 day',
      'SALES'::"InventoryDocumentType", ${invoicePrefix} || g, 1, 600, -600
    FROM generate_series(1, ${orders}::int) g CROSS JOIN generate_series(1, 2) n`);
  // Refresh planner statistics after bulk seeding; no production connection.
  for (const table of ['SalesInvoice', 'SalesInvoiceLine', 'JournalEntry', 'JournalLine', 'InventoryLedgerEntry']) {
    await db.$executeRawUnsafe(`ANALYZE "${table}"`); // names are fixed literals above
  }
  const filter = { organizationId: org.id };
  const checkSales = async () => {
    const rows = await readCustomerSales(db, filter);
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((s, r) => s + r.invoiceCount, 0), orders);
    assert.equal(rows.reduce((s, r) => s + r.total, 0), orders * 2000);
  };
  const checkGl = async () => {
    const totals = await readJournalTotals(db, { entry: { organizationId: org.id, status: 'POSTED' } });
    assert.equal(totals.length, 5);
    const report = buildTrialBalanceReport(accounts, totals);
    assert.equal(report.summary.totalDebit, orders * 4400);
    assert.equal(report.summary.totalCredit, orders * 4400);
  };
  await measure('annual customer sales', 5000, checkSales);
  await measure('monthly sales chart', 5000, async () => {
    const rows = await readSalesCalendar(db, filter, 'month');
    assert.equal(rows.length, 12);
    assert.equal(rows.reduce((s, r) => s + r.total, 0), orders * 2000);
  });
  await measure('top products', 5000, async () => {
    const rows = await readTopProducts(db, filter);
    assert.equal(rows.length, 100);
    assert.equal(rows.reduce((s, r) => s + r.qty, 0), orders * 2);
  });
  await measure('trial balance', 5000, checkGl);
  await measure('inventory valuation', 5000, async () => {
    const values = await computeLedgerValuation(db, org.id);
    assert.equal(values.size, 100);
    for (const value of values.values()) {
      assert.equal(value.totalQty, 0);
      assert.equal(value.totalValue, 0);
    }
  });
  await measure('invoice first page with count and lines', 2000, async () => {
    const [rows, count] = await Promise.all([
      db.salesInvoice.findMany({ where: filter, orderBy: { issueDate: 'desc' }, take: 50, include: { lines: true } }),
      db.salesInvoice.count({ where: filter }),
    ]);
    assert.equal(rows.length, 50);
    assert.equal(count, orders);
  });
  await measure('8 concurrent sales/GL readers', 10000, async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => i % 2 ? checkGl() : checkSales()));
  });
  const passed = metrics.every((m) => m.p95Ms <= m.targetMs);
  writeFileSync('docs/capacity-benchmark.latest.json', JSON.stringify({
    measuredAt: new Date().toISOString(), orders, syntheticTransactionRows: orders * 10 + 103,
    passed, metrics, scope: 'Warm database reads and aggregate correctness only; excludes HTTP, UI, imports, posting throughput and backups.',
  }, null, 2));
  if (!passed) process.exitCode = 1;
  console.log(`Benchmark ${passed ? 'passed' : 'missed one or more targets'}. Results: docs/capacity-benchmark.latest.json`);
} finally {
  if (orgId) {
    // Explicit dependency order avoids restrictive item/account foreign keys.
    await db.inventoryLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await db.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await db.salesInvoice.deleteMany({ where: { organizationId: orgId } });
    await db.organization.delete({ where: { id: orgId } });
  }
  await db.$disconnect();
}
