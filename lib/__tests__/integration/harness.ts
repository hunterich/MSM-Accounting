/**
 * Integration-test harness for GL invariants.
 *
 * Unlike the rest of the suite (which mocks Prisma), these tests run the real
 * posting functions against a real Postgres database and assert *whole-ledger*
 * invariants that only hold once state has accumulated across documents:
 * trial balance = 0, subledger == control account, inventory == ledger, voids
 * net to zero, etc.
 *
 * Isolation strategy: every test creates its own Organization with a unique id
 * and a freshly-seeded chart of accounts. All invariants are scoped by
 * organizationId, so tests never interfere — no shared state, no transaction
 * rollback gymnastics. Cleanup is best-effort; leftover rows in the test DB are
 * harmless because nothing is queried across orgs.
 *
 * SAFETY: this harness refuses to connect to any database whose name does not
 * end in `_test`, so it can never touch the dev/prod database by accident.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { toNumber, asMoney } from '../../money';
import {
  buildTrialBalanceReport,
  type GlAccount,
  type JournalLineRecord,
} from '../../gl-reporting';

/** Half-rupiah tolerance — absorbs Decimal(18,2) rounding, same as production. */
export const TOLERANCE = 0.01;

/**
 * Resolve the test database URL. Prefers TEST_DATABASE_URL, then DATABASE_URL
 * from the environment, then DATABASE_URL parsed out of `.env`. Whichever it
 * lands on, the database name is forced to end in `_test`.
 */
function resolveTestDatabaseUrl(): string {
  let base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) {
    const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const match = envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    base = match?.[1];
  }
  if (!base) {
    throw new Error('GL invariant tests: no DATABASE_URL / TEST_DATABASE_URL found');
  }

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    url.pathname = `/${dbName}_test`;
  }
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against non-test DB: ${url.pathname}`);
  }
  return url.toString();
}

export const prisma = new PrismaClient({
  datasources: { db: { url: resolveTestDatabaseUrl() } },
  log: ['error'],
});

/* ------------------------------------------------------------------ */
/* Org + chart-of-accounts seeding                                     */
/* ------------------------------------------------------------------ */

type AccountRole =
  | 'bankAsset'
  | 'arControl'
  | 'apTax'
  | 'inventoryAsset'
  | 'apControl'
  | 'grIrClearing'
  | 'openingBalanceEquity'
  | 'salesRevenue'
  | 'cogsExpense'
  | 'inventoryAdjustment';

const CHART_OF_ACCOUNTS: Array<{
  role: AccountRole;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalSide: 'DEBIT' | 'CREDIT';
}> = [
  { role: 'bankAsset', code: '1110', name: 'Cash & Bank', type: 'ASSET', normalSide: 'DEBIT' },
  { role: 'arControl', code: '1210', name: 'Accounts Receivable', type: 'ASSET', normalSide: 'DEBIT' },
  { role: 'inventoryAsset', code: '1310', name: 'Inventory', type: 'ASSET', normalSide: 'DEBIT' },
  { role: 'apTax', code: '1610', name: 'Input Tax (PPN Masukan)', type: 'ASSET', normalSide: 'DEBIT' },
  { role: 'apControl', code: '2100', name: 'Accounts Payable', type: 'LIABILITY', normalSide: 'CREDIT' },
  { role: 'grIrClearing', code: '2150', name: 'GR/IR Clearing', type: 'LIABILITY', normalSide: 'CREDIT' },
  { role: 'openingBalanceEquity', code: '3900', name: 'Opening Balance Equity', type: 'EQUITY', normalSide: 'CREDIT' },
  { role: 'salesRevenue', code: '4100', name: 'Sales Revenue', type: 'REVENUE', normalSide: 'CREDIT' },
  { role: 'cogsExpense', code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE', normalSide: 'DEBIT' },
  { role: 'inventoryAdjustment', code: '5190', name: 'Inventory Variance', type: 'EXPENSE', normalSide: 'DEBIT' },
];

export interface TestOrg {
  orgId: string;
  warehouseId: string;
  accounts: Record<AccountRole, string>;
}

let uniqueCounter = 0;
function uniqueSuffix(): string {
  uniqueCounter += 1;
  return `${Date.now().toString(36)}-${uniqueCounter}`;
}

export async function createTestOrg(opts?: {
  costingMethod?: 'FIFO' | 'WEIGHTED_AVERAGE';
  allowNegativeStock?: boolean;
}): Promise<TestOrg> {
  const tag = uniqueSuffix();
  const org = await prisma.organization.create({
    data: {
      legalName: `Test Org ${tag}`,
      displayName: `Test ${tag}`,
      costingMethod: opts?.costingMethod ?? 'FIFO',
      allowNegativeStock: opts?.allowNegativeStock ?? false,
      taxEnabled: true,
    },
    select: { id: true },
  });

  const accounts = {} as Record<AccountRole, string>;
  for (const spec of CHART_OF_ACCOUNTS) {
    const created = await prisma.account.create({
      data: {
        organizationId: org.id,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        normalSide: spec.normalSide,
        isActive: true,
        isPostable: true,
      },
      select: { id: true },
    });
    accounts[spec.role] = created.id;
  }

  // Wire the org's account-defaults to the seeded accounts so the posting
  // functions resolve deterministically (no reliance on code/keyword matching).
  await prisma.organization.update({
    where: { id: org.id },
    data: { accountDefaults: accounts as Prisma.InputJsonValue },
  });

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: org.id, code: 'WH-1', name: 'Main Warehouse' },
    select: { id: true },
  });

  return { orgId: org.id, warehouseId: warehouse.id, accounts };
}

/* ------------------------------------------------------------------ */
/* Convenience row factories                                           */
/* ------------------------------------------------------------------ */

export async function createVendor(orgId: string): Promise<string> {
  const v = await prisma.vendor.create({
    data: { organizationId: orgId, code: `V-${uniqueSuffix()}`, name: 'Test Vendor' },
    select: { id: true },
  });
  return v.id;
}

export async function createCustomer(orgId: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { organizationId: orgId, code: `C-${uniqueSuffix()}`, name: 'Test Customer' },
    select: { id: true },
  });
  return c.id;
}

export async function createItem(orgId: string, costPrice = 0): Promise<string> {
  const item = await prisma.item.create({
    data: {
      organizationId: orgId,
      sku: `SKU-${uniqueSuffix()}`,
      name: 'Test Product',
      type: 'PRODUCT',
      costPrice,
    },
    select: { id: true },
  });
  return item.id;
}

/* ------------------------------------------------------------------ */
/* Invariant assertions                                                */
/* ------------------------------------------------------------------ */

async function loadAccounts(orgId: string): Promise<GlAccount[]> {
  const rows = await prisma.account.findMany({
    where: { organizationId: orgId },
    select: { id: true, code: true, name: true, type: true, normalSide: true, isPostable: true },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    normalSide: r.normalSide,
    isPostable: r.isPostable,
  }));
}

async function loadPostedLines(orgId: string): Promise<JournalLineRecord[]> {
  const lines = await prisma.journalLine.findMany({
    where: { entry: { organizationId: orgId, status: 'POSTED' } },
    select: { accountId: true, debit: true, credit: true },
  });
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: toNumber(l.debit),
    credit: toNumber(l.credit),
  }));
}

/**
 * THE master invariant. Asserts both:
 *   (a) every individual posted entry balances (Σdebit === Σcredit), and
 *   (b) the org-wide trial balance balances (ending debit === ending credit).
 * Returns the trial-balance report for further per-account assertions.
 */
export async function assertTrialBalanced(orgId: string, label = '') {
  const entries = await prisma.journalEntry.findMany({
    where: { organizationId: orgId, status: 'POSTED' },
    select: { entryNo: true, lines: { select: { debit: true, credit: true } } },
  });
  for (const entry of entries) {
    const dr = asMoney(entry.lines.reduce((s, l) => s + toNumber(l.debit), 0));
    const cr = asMoney(entry.lines.reduce((s, l) => s + toNumber(l.credit), 0));
    if (Math.abs(dr - cr) > TOLERANCE) {
      throw new Error(`${label} entry ${entry.entryNo} unbalanced: dr=${dr} cr=${cr}`);
    }
  }

  const [accounts, lines] = await Promise.all([loadAccounts(orgId), loadPostedLines(orgId)]);
  const report = buildTrialBalanceReport(accounts, lines);
  const { endingDebit, endingCredit } = report.summary;
  if (Math.abs(endingDebit - endingCredit) > TOLERANCE) {
    throw new Error(
      `${label} trial balance does not balance: endingDebit=${endingDebit} endingCredit=${endingCredit}`,
    );
  }
  return report;
}

/** Signed debit-positive net balance of an account across posted entries. */
export async function accountBalance(orgId: string, accountId: string): Promise<number> {
  const lines = await prisma.journalLine.findMany({
    where: { accountId, entry: { organizationId: orgId, status: 'POSTED' } },
    select: { debit: true, credit: true },
  });
  return asMoney(lines.reduce((s, l) => s + toNumber(l.debit) - toNumber(l.credit), 0));
}

/** Cumulative net inventory value from the immutable ledger. */
export async function inventoryLedgerValue(orgId: string): Promise<number> {
  const rows = await prisma.inventoryLedgerEntry.findMany({
    where: { organizationId: orgId },
    select: { valueChange: true },
  });
  return asMoney(rows.reduce((s, r) => s + toNumber(r.valueChange), 0));
}

/** On-hand inventory value from open cost layers (qtyBalance × unitCost). */
export async function inventoryLotValue(orgId: string): Promise<number> {
  const lots = await prisma.inventoryLot.findMany({
    where: { organizationId: orgId },
    select: { qtyBalance: true, unitCost: true },
  });
  return asMoney(lots.reduce((s, l) => s + toNumber(l.qtyBalance) * toNumber(l.unitCost), 0));
}

export async function journalEntryCount(orgId: string): Promise<number> {
  return prisma.journalEntry.count({ where: { organizationId: orgId } });
}

/**
 * Inventory reconciliation invariant: the immutable ledger's net value must
 * equal the open cost layers' value. Holds after every inventory movement —
 * including reversals (reverseAddedLayers) and restores (restoreConsumedLayers).
 * The reusable assertion for void round-trips in Phases 3-5. Returns both values.
 */
export async function assertInventoryReconciled(orgId: string, label = '') {
  const [ledger, lots] = await Promise.all([inventoryLedgerValue(orgId), inventoryLotValue(orgId)]);
  if (Math.abs(ledger - lots) > TOLERANCE) {
    throw new Error(`${label} inventory not reconciled: ledger=${ledger} lots=${lots}`);
  }
  return { ledger, lots };
}

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */

export async function cleanupOrg(orgId: string): Promise<void> {
  // Best-effort; child rows cascade where the schema allows. Leftover test-DB
  // rows are harmless because every assertion is org-scoped.
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
