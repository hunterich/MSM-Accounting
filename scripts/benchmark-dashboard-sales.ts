/**
 * Read-only timing and EXPLAIN for an existing company's dashboard sales query.
 * Usage: DATABASE_URL=... npx tsx scripts/benchmark-dashboard-sales.ts ORG_ID YYYY-MM-DD YYYY-MM-DD
 * Dates are Jakarta business days. No seeding, statistics refresh or data writes.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { dashboardSalesQuery, readDashboardSales } from '../lib/dashboard-sales';
import { reportDate } from '../lib/subledger-history';

const [orgId, fromText, toText] = process.argv.slice(2);
if (!orgId || !fromText || !toText) throw new Error('Provide ORG_ID, dateFrom and dateTo.');
const from = reportDate(fromText, false), to = reportDate(toText, true);
if (from > to) throw new Error('dateFrom must be before or equal to dateTo.');
const today = reportDate(null, false), asOf = reportDate(null, true);
const db = new PrismaClient();
try {
  const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true, displayName: true } });
    if (!org) throw new Error('Company not found.');
    const invoiceCount = await tx.salesInvoice.count({ where: { organizationId: orgId } });
    const samplesMs: number[] = [];
    let balances;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      balances = await readDashboardSales(tx, orgId, from, to, today, asOf);
      samplesMs.push(Math.round((performance.now() - start) * 100) / 100);
    }
    const plan = await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${dashboardSalesQuery(orgId, from, to, today, asOf)}`);
    return { company: org, invoiceCount, samplesMs, firstReadMs: samplesMs[0],
      warmP95Ms: [...samplesMs.slice(1)].sort((a, b) => a - b).at(-1), balances, plan };
  }, { timeout: 180000 });
  console.log(JSON.stringify(result, null, 2));
} finally { await db.$disconnect(); }
