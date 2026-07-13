# Accurate Migration — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side foundation for migrating an Accurate Online company into MSM as a single staged, reconciled, reversible batch — with no double-counting of control-account balances.

**Architecture:** A new `lib/migration/` module holds a pure reconciliation engine, a batch service (create/stage/get/commit/rollback), and a commit writer that persists master data + a single opening journal (the GL totals) plus subledger-only AR/AP and lots-only opening stock (the detail). A new `MigrationBatch` Prisma model anchors staging and rollback; every record the commit writes is stamped with `migrationBatchId`. API routes under `/api/v1/migration/` expose it. This is Plan 1 of 2; the wizard UI (Plan 2) consumes these routes.

**Tech Stack:** Next.js (App Router, `runtime = 'nodejs'`), Prisma + PostgreSQL, Zod, Vitest (unit + real-Postgres integration via `lib/__tests__/integration/harness.ts`).

---

## Background the engineer needs

- **The double-counting rule.** A trial balance already contains AR-control, AP-control, and Inventory-asset totals. So on migration: post the trial balance **once** as the opening journal (sets every GL balance), and create open AR invoices / AP bills / opening stock as **detail only, with NO additional GL posting**.
- **What already avoids GL posting:** the existing opening-invoices / opening-bills persist logic in `src/app/api/v1/import/[entity]/route.ts` creates `SalesInvoice` / `Bill` records **without** posting any journal — so AR/AP opening is already GL-free. **The one GL-posting culprit is opening stock**: `postOpeningStockIfNeeded` (`lib/inventory-opening.ts`) posts `DR Inventory / CR Opening Balance Equity`. Migration must create the stock **lots only, without that journal** (Task 3).
- **Reconciliation (the safety net).** Before commit, four checks must pass or commit is refused:
  1. TB total debits = TB total credits.
  2. Σ open AR invoice amounts = AR-control balance in the TB.
  3. Σ open AP bill amounts = AP-control balance in the TB.
  4. Σ opening stock value = Inventory-asset balance in the TB.
- **Control-account identification.** The org's AR-control, AP-control, and Inventory-asset accounts are the ones referenced by `OrganizationAccountDefaults` (loaded via `loadOrgAccountDefaults` in `lib/account-defaults.ts`). The reconciliation engine receives their **account codes** as input; the batch service resolves them from the org defaults.
- **Verification.** After commit, the live Trial Balance report (`buildTrialBalanceReport` in `lib/gl-reporting.ts`, as-of the cutover date) must equal the imported TB. An integration test asserts this.
- **Existing import row schemas** live in `src/app/api/v1/import/[entity]/route.ts` (CustomerRowSchema, VendorRowSchema, ItemRowSchema, AccountRowSchema, OpeningJournalLineSchema, OpeningInvoiceSchema, OpeningBillSchema). Task 5 reuses their shapes; extract shared schemas in Task 5 Step 1.
- **Integration harness** (`lib/__tests__/integration/harness.ts`) exports: `prisma`, `createTestOrg`, `createCustomer`, `createVendor`, `createItem`, `assertTrialBalanced`, `accountBalance`, `inventoryLedgerValue`, `inventoryLotValue`, `journalEntryCount`, `cleanupOrg`, `disconnect`, `TOLERANCE`. Run integration tests with `npm run test:int`; unit tests with `npm test`.

## File structure

- Create `lib/migration/reconcile.ts` — pure reconciliation engine + types.
- Create `lib/migration/schemas.ts` — shared Zod row schemas + the staged-batch payload schema.
- Create `lib/migration/batch-service.ts` — create / get / stage / list for a batch.
- Create `lib/migration/commit.ts` — the migration-mode commit writer.
- Create `lib/migration/rollback.ts` — reverse-order teardown + guard.
- Modify `lib/inventory-opening.ts` — add `postGl` param to `postOpeningStockIfNeeded`.
- Modify `prisma/schema.prisma` — `MigrationBatch` model + `migrationBatchId` columns.
- Create routes: `src/app/api/v1/migration/batches/route.ts` (POST create, GET list), `src/app/api/v1/migration/batches/[id]/route.ts` (GET one), `.../[id]/stage/route.ts` (POST stage entity), `.../[id]/reconcile/route.ts` (GET preview checks), `.../[id]/commit/route.ts` (POST), `.../[id]/rollback/route.ts` (POST).
- Tests: `lib/__tests__/migration-reconcile.test.ts` (unit); `lib/__tests__/integration/migration-commit.int.test.ts`, `migration-rollback.int.test.ts`, `migration-opening-stock-nogl.int.test.ts` (integration).

---

## Task 1: Schema — MigrationBatch model + stamping columns

**Files:**
- Modify: `prisma/schema.prisma`
- Command: prisma migrate + generate

- [ ] **Step 1: Add the `MigrationBatch` model and enum**

Add near the other domain models in `prisma/schema.prisma`:

```prisma
enum MigrationBatchStatus {
  DRAFT
  COMMITTED
  ROLLED_BACK
}

model MigrationBatch {
  id             String               @id @default(cuid())
  organizationId String
  cutoverDate    DateTime
  status         MigrationBatchStatus @default(DRAFT)
  // Staged, mapped-and-validated rows per entity, keyed by entity name.
  // Shape: { accounts: [...], customers: [...], items: [...], "opening-journal": [...], ... }
  stagedData     Json                 @default("{}")
  // Denormalised counts/totals captured at commit for the summary + audit.
  summary        Json?
  createdById    String?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User?        @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@index([organizationId, status])
}
```

- [ ] **Step 2: Add the nullable stamping column to each affected model**

Add `migrationBatchId String?` (plus `@@index([migrationBatchId])`) to: `Account`, `Customer`, `Vendor`, `Item`, `JournalEntry`, `SalesInvoice`, `Bill`, `InventoryLot`, `InventoryLedgerEntry`. Example for `Account`:

```prisma
model Account {
  // ...existing fields...
  migrationBatchId String?

  // ...existing relations...
  @@index([migrationBatchId])
}
```

Also add the back-relation on `Organization` and `User`:

```prisma
// in model Organization
  migrationBatches MigrationBatch[]
// in model User
  migrationBatches MigrationBatch[]
```

- [ ] **Step 3: Create the migration and regenerate the client**

Run:
```bash
npx prisma migrate dev --name migration_batch
npx prisma generate
```
Expected: a new folder under `prisma/migrations/*_migration_batch/` and "Generated Prisma Client" output. (Note: the Prisma client is shared across worktrees — always `npx prisma generate` here before typechecking.)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `MigrationBatch` or `migrationBatchId`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(migration): add MigrationBatch model + migrationBatchId stamping columns"
```

---

## Task 2: Reconciliation engine (pure function)

**Files:**
- Create: `lib/migration/reconcile.ts`
- Test: `lib/__tests__/migration-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/migration-reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { reconcileMigration, type ReconcileInput } from '../migration/reconcile';

const base: ReconcileInput = {
  controlCodes: { ar: '1-1200', ap: '2-1100', inventory: '1-1400' },
  trialBalance: [
    { accountCode: '1-1200', debit: 10_000_000, credit: 0 }, // AR control
    { accountCode: '2-1100', debit: 0, credit: 6_000_000 },  // AP control
    { accountCode: '1-1400', debit: 4_000_000, credit: 0 },  // Inventory
    { accountCode: '3-9000', debit: 0, credit: 8_000_000 },  // Opening equity (plug)
  ],
  openAr: [{ amount: 6_000_000 }, { amount: 4_000_000 }],     // sums to 10,000,000
  openAp: [{ amount: 6_000_000 }],                            // sums to 6,000,000
  openingStock: [{ value: 4_000_000 }],                       // sums to 4,000,000
};

describe('reconcileMigration', () => {
  it('passes when TB balances and all subledgers tie to control accounts', () => {
    const r = reconcileMigration(base);
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.pass)).toBe(true);
  });

  it('fails the balance check when TB debits != credits', () => {
    const r = reconcileMigration({
      ...base,
      trialBalance: [...base.trialBalance, { accountCode: '1-1000', debit: 500, credit: 0 }],
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'tb-balanced')!.pass).toBe(false);
  });

  it('fails the AR tie-out when open invoices do not sum to AR control', () => {
    const r = reconcileMigration({ ...base, openAr: [{ amount: 9_999_000 }] });
    expect(r.ok).toBe(false);
    const c = r.checks.find((x) => x.id === 'ar-tie')!;
    expect(c.pass).toBe(false);
    expect(c.expected).toBe(10_000_000);
    expect(c.actual).toBe(9_999_000);
  });

  it('fails the inventory tie-out when stock value != inventory control', () => {
    const r = reconcileMigration({ ...base, openingStock: [{ value: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'inventory-tie')!.pass).toBe(false);
  });

  it('treats an all-empty migration as passing (nothing to reconcile)', () => {
    const r = reconcileMigration({
      controlCodes: base.controlCodes,
      trialBalance: [],
      openAr: [],
      openAp: [],
      openingStock: [],
    });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/migration-reconcile.test.ts`
Expected: FAIL — "Cannot find module '../migration/reconcile'".

- [ ] **Step 3: Implement the engine**

```ts
// lib/migration/reconcile.ts
export interface ReconcileInput {
  controlCodes: { ar: string; ap: string; inventory: string };
  trialBalance: { accountCode: string; debit: number; credit: number }[];
  openAr: { amount: number }[];
  openAp: { amount: number }[];
  openingStock: { value: number }[];
}

export interface ReconcileCheck {
  id: 'tb-balanced' | 'ar-tie' | 'ap-tie' | 'inventory-tie';
  label: string;
  expected: number;
  actual: number;
  pass: boolean;
}

export interface ReconcileResult {
  ok: boolean;
  checks: ReconcileCheck[];
}

const TOL = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (arr: number[]) => round2(arr.reduce((a, b) => a + b, 0));

/**
 * Net debit-minus-credit for a control account in the trial balance.
 * AR & Inventory are debit-normal (positive when debit); AP is credit-normal
 * (positive when credit), so callers compare against the appropriate sign.
 */
function tbBalance(tb: ReconcileInput['trialBalance'], code: string): number {
  const rows = tb.filter((r) => r.accountCode === code);
  return round2(rows.reduce((a, r) => a + r.debit - r.credit, 0));
}

export function reconcileMigration(input: ReconcileInput): ReconcileResult {
  const totalDebit = sum(input.trialBalance.map((r) => r.debit));
  const totalCredit = sum(input.trialBalance.map((r) => r.credit));

  const arControl = tbBalance(input.trialBalance, input.controlCodes.ar);        // debit-normal
  const apControl = -tbBalance(input.trialBalance, input.controlCodes.ap);       // credit-normal → flip sign
  const invControl = tbBalance(input.trialBalance, input.controlCodes.inventory); // debit-normal

  const arActual = sum(input.openAr.map((x) => x.amount));
  const apActual = sum(input.openAp.map((x) => x.amount));
  const invActual = sum(input.openingStock.map((x) => x.value));

  const mk = (
    id: ReconcileCheck['id'],
    label: string,
    expected: number,
    actual: number,
  ): ReconcileCheck => ({ id, label, expected, actual, pass: Math.abs(expected - actual) <= TOL });

  const checks: ReconcileCheck[] = [
    mk('tb-balanced', 'Trial balance debits equal credits', totalDebit, totalCredit),
    mk('ar-tie', 'Open AR invoices tie to AR control account', arControl, arActual),
    mk('ap-tie', 'Open AP bills tie to AP control account', apControl, apActual),
    mk('inventory-tie', 'Opening stock value ties to inventory account', invControl, invActual),
  ];

  return { ok: checks.every((c) => c.pass), checks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/migration-reconcile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/migration/reconcile.ts lib/__tests__/migration-reconcile.test.ts
git commit -m "feat(migration): pure reconciliation engine with four tie-out checks"
```

---

## Task 3: Opening-stock lots-only mode (no GL posting)

**Files:**
- Modify: `lib/inventory-opening.ts` (add `postGl` param to `postOpeningStockIfNeeded`)
- Test: `lib/__tests__/integration/migration-opening-stock-nogl.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// lib/__tests__/integration/migration-opening-stock-nogl.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { postOpeningStockIfNeeded } from '../../inventory-opening';
import {
  prisma, createTestOrg, inventoryLotValue, journalEntryCount, cleanupOrg, disconnect,
} from './harness';

afterAll(async () => { await disconnect(); });
const DATE = new Date('2026-01-01T00:00:00.000Z');

describe('opening stock, migration mode (postGl=false)', () => {
  it('writes the lot but posts NO journal entry', async () => {
    const org = await createTestOrg();
    const item = await prisma.item.create({
      data: {
        organizationId: org.id, name: 'Widget', sku: 'WIDGET',
        type: 'PRODUCT', unit: 'PCS', sellingPrice: 0,
        costPrice: 1_000_000, openingStock: 5,
      },
    });

    const before = await journalEntryCount(org.id);
    await prisma.$transaction((tx) =>
      postOpeningStockIfNeeded(tx, org.id, item.id, DATE, { postGl: false }),
    );
    const after = await journalEntryCount(org.id);

    expect(await inventoryLotValue(org.id)).toBeCloseTo(5_000_000, 2); // lot exists
    expect(after).toBe(before);                                        // no JE posted

    await cleanupOrg(org.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:int -- migration-opening-stock-nogl`
Expected: FAIL — `postOpeningStockIfNeeded` currently takes no options object; the JE count increases.

- [ ] **Step 3: Add the `postGl` option**

In `lib/inventory-opening.ts`, change the signature and guard the journal block:

```ts
export async function postOpeningStockIfNeeded(
  tx: Tx,
  orgId: string,
  itemId: string,
  date: Date = new Date(),
  opts: { postGl?: boolean } = {},
): Promise<void> {
  const postGl = opts.postGl !== false; // default true — preserves existing callers
  // ...unchanged: advisory lock, item load, type/qty guards, idempotency check...

  // Always write the cost layer + perpetual ledger (unchanged):
  await addCostLayer(tx, orgId, itemId, null, qty, unitCost, InventoryDocumentType.OPENING, item.id, date);

  // Only post a journal entry when value > 0 AND caller wants GL posting.
  const value = asMoney(qty * unitCost);
  if (value <= 0 || !postGl) return;

  // ...unchanged journal-posting block below...
}
```

- [ ] **Step 4: Run the new test AND the existing opening-stock test**

Run: `npm run test:int -- migration-opening-stock-nogl import-opening-stock`
Expected: both PASS — the new one confirms no JE; the existing `import-opening-stock` (default `postGl=true`) still posts the JE.

- [ ] **Step 5: Commit**

```bash
git add lib/inventory-opening.ts lib/__tests__/integration/migration-opening-stock-nogl.int.test.ts
git commit -m "feat(migration): postOpeningStockIfNeeded gains lots-only (postGl:false) mode"
```

---

## Task 4: Shared schemas + batch service (create / get / stage)

**Files:**
- Create: `lib/migration/schemas.ts`
- Create: `lib/migration/batch-service.ts`
- Test: `lib/__tests__/integration/migration-batch-service.int.test.ts`

- [ ] **Step 1: Extract shared row schemas**

Create `lib/migration/schemas.ts` mirroring the shapes in `src/app/api/v1/import/[entity]/route.ts`, plus a `parentCode` on the account schema (used in Task 7) and a `value` on the stock schema:

```ts
// lib/migration/schemas.ts
import { z } from 'zod';

export const AccountRow = z.object({
  code: z.string().min(1), name: z.string().min(1),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  parentCode: z.string().optional(),
});
export const CustomerRow = z.object({
  name: z.string().min(1), email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(), address: z.string().optional(), npwp: z.string().optional(),
});
export const VendorRow = z.object({
  name: z.string().min(1), email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(), address: z.string().optional(), npwp: z.string().optional(),
});
export const ItemRow = z.object({
  name: z.string().min(1), sku: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE', 'RAW_MATERIAL']).optional().default('PRODUCT'),
  unit: z.string().optional().default('PCS'),
  salePrice: z.coerce.number().min(0).optional().default(0),
  purchasePrice: z.coerce.number().min(0).optional().default(0),
  openingStock: z.coerce.number().min(0).optional().default(0),
  openingValue: z.coerce.number().min(0).optional().default(0),
});
export const OpeningJournalRow = z.object({
  accountCode: z.string().min(1),
  debit: z.coerce.number().min(0).optional().default(0),
  credit: z.coerce.number().min(0).optional().default(0),
});
export const OpeningInvoiceRow = z.object({
  customerName: z.string().min(1), invoiceNumber: z.string().optional(),
  issueDate: z.string().min(1), dueDate: z.string().optional(),
  amount: z.coerce.number().min(0),
});
export const OpeningBillRow = z.object({
  vendorName: z.string().min(1), billNumber: z.string().optional(),
  issueDate: z.string().min(1), dueDate: z.string().optional(),
  amount: z.coerce.number().min(0),
});

export const MIGRATION_ENTITIES = [
  'accounts', 'customers', 'vendors', 'items',
  'opening-journal', 'opening-invoices', 'opening-bills',
] as const;
export type MigrationEntity = (typeof MIGRATION_ENTITIES)[number];

export const ENTITY_SCHEMA: Record<MigrationEntity, z.ZodTypeAny> = {
  accounts: AccountRow, customers: CustomerRow, vendors: VendorRow, items: ItemRow,
  'opening-journal': OpeningJournalRow, 'opening-invoices': OpeningInvoiceRow,
  'opening-bills': OpeningBillRow,
};

export function validateRows(entity: MigrationEntity, rows: unknown[]) {
  const schema = ENTITY_SCHEMA[entity];
  const valid: unknown[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const r = schema.safeParse(row);
    if (r.success) valid.push(r.data);
    else errors.push({ row: i + 2, message: r.error.issues.map((x) => x.message).join('; ') });
  });
  return { valid, errors };
}
```

- [ ] **Step 2: Write the failing batch-service integration test**

```ts
// lib/__tests__/integration/migration-batch-service.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { createBatch, stageEntity, getBatch } from '../../migration/batch-service';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => { await disconnect(); });

describe('migration batch service', () => {
  it('creates a DRAFT batch and stages validated rows', async () => {
    const org = await createTestOrg();
    const batch = await createBatch(org.id, new Date('2026-01-01'), null);
    expect(batch.status).toBe('DRAFT');

    const res = await stageEntity(org.id, batch.id, 'customers', [
      { name: 'PT Andi' }, { name: '' }, // second row invalid
    ]);
    expect(res.staged).toBe(1);
    expect(res.errors.length).toBe(1);

    const reloaded = await getBatch(org.id, batch.id);
    expect((reloaded!.stagedData as any).customers).toHaveLength(1);
    await cleanupOrg(org.id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:int -- migration-batch-service`
Expected: FAIL — "Cannot find module '../../migration/batch-service'".

- [ ] **Step 4: Implement the batch service**

```ts
// lib/migration/batch-service.ts
import { prisma } from '@/lib/prisma';
import { MIGRATION_ENTITIES, validateRows, type MigrationEntity } from './schemas';

export async function createBatch(orgId: string, cutoverDate: Date, userId: string | null) {
  return prisma.migrationBatch.create({
    data: { organizationId: orgId, cutoverDate, createdById: userId },
  });
}

export async function getBatch(orgId: string, batchId: string) {
  return prisma.migrationBatch.findFirst({ where: { id: batchId, organizationId: orgId } });
}

export async function listBatches(orgId: string) {
  return prisma.migrationBatch.findMany({
    where: { organizationId: orgId }, orderBy: { createdAt: 'desc' },
  });
}

export async function stageEntity(
  orgId: string, batchId: string, entity: MigrationEntity, rows: unknown[],
) {
  if (!MIGRATION_ENTITIES.includes(entity)) throw new Error(`Unknown entity: ${entity}`);
  const batch = await getBatch(orgId, batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'DRAFT') throw new Error('Batch is not editable');

  const { valid, errors } = validateRows(entity, rows);
  const staged = { ...(batch.stagedData as Record<string, unknown[]>), [entity]: valid };
  await prisma.migrationBatch.update({ where: { id: batchId }, data: { stagedData: staged } });
  return { staged: valid.length, errors };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:int -- migration-batch-service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/migration/schemas.ts lib/migration/batch-service.ts lib/__tests__/integration/migration-batch-service.int.test.ts
git commit -m "feat(migration): shared row schemas + batch service (create/get/stage)"
```

---

## Task 5: Commit writer (reconcile → write stamped records)

**Files:**
- Create: `lib/migration/commit.ts`
- Test: `lib/__tests__/integration/migration-commit.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

The test stages a tiny but complete Accurate-shaped dataset, commits, then asserts: reconciliation passed, the live Trial Balance report as-of cutover equals the imported TB, AR/AP subledger ties to control, inventory ties to control, and every written record carries `migrationBatchId`.

```ts
// lib/__tests__/integration/migration-commit.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { createBatch, stageEntity } from '../../migration/batch-service';
import { commitBatch } from '../../migration/commit';
import { buildTrialBalanceReport } from '../../gl-reporting';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => { await disconnect(); });
const CUTOVER = new Date('2026-01-01T00:00:00.000Z');

describe('migration commit', () => {
  it('writes a balanced, reconciled, stamped migration', async () => {
    const org = await createTestOrg(); // seeds standard COA incl. AR/AP/Inventory/Opening Equity
    const batch = await createBatch(org.id, CUTOVER, null);

    // Master data
    await stageEntity(org.id, batch.id, 'customers', [{ name: 'PT Andi' }]);
    await stageEntity(org.id, batch.id, 'vendors', [{ name: 'CV Boga' }]);
    await stageEntity(org.id, batch.id, 'items', [
      { name: 'Widget', sku: 'WIDGET', type: 'PRODUCT', openingStock: 4, openingValue: 4_000_000 },
    ]);

    // Opening balances. Use the org's actual control-account codes.
    const arCode = await controlCode(org.id, 'AR');
    const apCode = await controlCode(org.id, 'AP');
    const invCode = await controlCode(org.id, 'INVENTORY');
    const eqCode = await controlCode(org.id, 'OPENING_EQUITY');

    await stageEntity(org.id, batch.id, 'opening-journal', [
      { accountCode: arCode, debit: 10_000_000, credit: 0 },
      { accountCode: invCode, debit: 4_000_000, credit: 0 },
      { accountCode: apCode, debit: 0, credit: 6_000_000 },
      { accountCode: eqCode, debit: 0, credit: 8_000_000 },
    ]);
    await stageEntity(org.id, batch.id, 'opening-invoices', [
      { customerName: 'PT Andi', issueDate: '2025-12-01', amount: 10_000_000 },
    ]);
    await stageEntity(org.id, batch.id, 'opening-bills', [
      { vendorName: 'CV Boga', issueDate: '2025-12-05', amount: 6_000_000 },
    ]);

    const result = await commitBatch(org.id, batch.id, null);
    expect(result.reconcile.ok).toBe(true);
    expect(result.committed).toBe(true);

    // Live TB as-of cutover equals imported TB.
    const tb = await buildTrialBalanceReport(org.id, CUTOVER);
    const row = (code: string) => tb.rows.find((r) => r.accountCode === code);
    expect(Number(row(arCode)!.debitBalance)).toBeCloseTo(10_000_000, 2);
    expect(Number(row(apCode)!.creditBalance)).toBeCloseTo(6_000_000, 2);
    expect(Number(row(invCode)!.debitBalance)).toBeCloseTo(4_000_000, 2);

    // Exactly ONE opening journal (no double-posting from stock).
    const jes = await prisma.journalEntry.count({
      where: { organizationId: org.id, source: 'OPENING' },
    });
    expect(jes).toBe(1);

    // Everything stamped.
    const stampedInvoices = await prisma.salesInvoice.count({
      where: { organizationId: org.id, migrationBatchId: batch.id },
    });
    expect(stampedInvoices).toBe(1);

    await cleanupOrg(org.id);
  });
});

// Resolve a control-account code from the org's account defaults.
async function controlCode(orgId: string, key: 'AR' | 'AP' | 'INVENTORY' | 'OPENING_EQUITY') {
  const { resolveControlCodes } = await import('../../migration/commit');
  const codes = await resolveControlCodes(orgId);
  return codes[key];
}
```

> Note: `buildTrialBalanceReport`'s exact row field names (`accountCode`, `debitBalance`, `creditBalance`) are defined in `lib/gl-reporting.ts` (`TrialBalanceRow`, ~line 47). Confirm and match them when implementing; adjust the test's accessors if the interface differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:int -- migration-commit`
Expected: FAIL — "Cannot find module '../../migration/commit'".

- [ ] **Step 3: Implement the commit writer**

Key rules: (a) run reconciliation first and abort (no writes) if `!ok`; (b) do all writes in one `prisma.$transaction`; (c) stamp every created row with `migrationBatchId`; (d) create items **without** using the GL-posting opening-stock path, then call `postOpeningStockIfNeeded(tx, …, { postGl: false })`; (e) AR/AP invoices/bills created as plain SENT/OPEN records (no journal); (f) post the opening journal exactly as the existing import route does but stamped and dated at `cutoverDate`; (g) mark batch `COMMITTED` with a `summary`.

```ts
// lib/migration/commit.ts
import { prisma } from '@/lib/prisma';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from '@/lib/account-defaults';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { reconcileMigration, type ReconcileResult } from './reconcile';
import { getBatch } from './batch-service';
import type { z } from 'zod';
import type {
  AccountRow, CustomerRow, VendorRow, ItemRow,
  OpeningJournalRow, OpeningInvoiceRow, OpeningBillRow,
} from './schemas';

export async function resolveControlCodes(orgId: string) {
  const defaults = await loadOrgAccountDefaults(orgId);
  const arId = resolveAccountDefaultId(defaults, 'AR');           // adjust key names to
  const apId = resolveAccountDefaultId(defaults, 'AP');           // whatever lib/account-defaults
  const invId = resolveAccountDefaultId(defaults, 'INVENTORY');   // actually exposes
  const eqId = resolveAccountDefaultId(defaults, 'OPENING_EQUITY');
  const accts = await prisma.account.findMany({
    where: { organizationId: orgId, id: { in: [arId, apId, invId, eqId].filter(Boolean) as string[] } },
    select: { id: true, code: true },
  });
  const codeOf = (id: string | null) => accts.find((a) => a.id === id)?.code ?? '';
  return { AR: codeOf(arId), AP: codeOf(apId), INVENTORY: codeOf(invId), OPENING_EQUITY: codeOf(eqId) };
}

export async function commitBatch(orgId: string, batchId: string, userId: string | null) {
  const batch = await getBatch(orgId, batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'DRAFT') throw new Error('Batch already committed or rolled back');

  const staged = batch.stagedData as {
    accounts?: z.infer<typeof AccountRow>[]; customers?: z.infer<typeof CustomerRow>[];
    vendors?: z.infer<typeof VendorRow>[]; items?: z.infer<typeof ItemRow>[];
    'opening-journal'?: z.infer<typeof OpeningJournalRow>[];
    'opening-invoices'?: z.infer<typeof OpeningInvoiceRow>[];
    'opening-bills'?: z.infer<typeof OpeningBillRow>[];
  };

  const control = await resolveControlCodes(orgId);
  const reconcile: ReconcileResult = reconcileMigration({
    controlCodes: { ar: control.AR, ap: control.AP, inventory: control.INVENTORY },
    trialBalance: (staged['opening-journal'] ?? []).map((l) => ({
      accountCode: l.accountCode, debit: l.debit ?? 0, credit: l.credit ?? 0,
    })),
    openAr: (staged['opening-invoices'] ?? []).map((i) => ({ amount: i.amount })),
    openAp: (staged['opening-bills'] ?? []).map((b) => ({ amount: b.amount })),
    openingStock: (staged.items ?? []).map((it) => ({ value: it.openingValue ?? 0 })),
  });

  if (!reconcile.ok) return { committed: false, reconcile };

  await prisma.$transaction(async (tx) => {
    // 1. Accounts (Task 7 adds parent linking) — stamped.
    // 2. Customers / Vendors — stamped.
    // 3. Items — create stamped item, then postOpeningStockIfNeeded(tx, …, { postGl: false }).
    // 4. Opening journal — one POSTED JournalEntry dated batch.cutoverDate, source OPENING, stamped.
    // 5. Opening invoices / bills — stamped SENT/OPEN records (no journal), dated per row.
    // (Reuse the exact create shapes from src/app/api/v1/import/[entity]/route.ts,
    //  adding `migrationBatchId: batchId` to every create and using cutoverDate.)
    await tx.migrationBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMMITTED',
        summary: {
          accounts: staged.accounts?.length ?? 0,
          customers: staged.customers?.length ?? 0,
          vendors: staged.vendors?.length ?? 0,
          items: staged.items?.length ?? 0,
          openingInvoices: staged['opening-invoices']?.length ?? 0,
          openingBills: staged['opening-bills']?.length ?? 0,
        },
      },
    });
  });

  return { committed: true, reconcile };
}
```

> The commit body's create shapes (steps 1–5 in the transaction) must mirror the persist blocks already proven in `src/app/api/v1/import/[entity]/route.ts` (customers, vendors, items, accounts, opening-journal, opening-invoices, opening-bills) — copy those field mappings verbatim, add `migrationBatchId: batchId` to each `create`, and use `batch.cutoverDate` instead of `new Date()` for journal/invoice/bill dates. Do not invent new field mappings.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:int -- migration-commit`
Expected: PASS — reconciliation ok, TB matches, exactly one OPENING journal, records stamped.

- [ ] **Step 5: Add a red-path test (commit refused when unbalanced)**

Append to the same test file:

```ts
it('refuses to commit and writes nothing when reconciliation fails', async () => {
  const org = await createTestOrg();
  const batch = await createBatch(org.id, CUTOVER, null);
  const arCode = (await resolveControlCodes(org.id)).AR;
  await stageEntity(org.id, batch.id, 'opening-journal', [
    { accountCode: arCode, debit: 100, credit: 0 }, // unbalanced
  ]);
  const result = await commitBatch(org.id, batch.id, null);
  expect(result.committed).toBe(false);
  expect(await prisma.journalEntry.count({ where: { organizationId: org.id, source: 'OPENING' } })).toBe(0);
  await cleanupOrg(org.id);
});
```
Run: `npm run test:int -- migration-commit`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/migration/commit.ts lib/__tests__/integration/migration-commit.int.test.ts
git commit -m "feat(migration): commit writer — reconcile-gated, stamped, no double-count"
```

---

## Task 6: Rollback service

**Files:**
- Create: `lib/migration/rollback.ts`
- Test: `lib/__tests__/integration/migration-rollback.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// lib/__tests__/integration/migration-rollback.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { createBatch, stageEntity } from '../../migration/batch-service';
import { commitBatch, resolveControlCodes } from '../../migration/commit';
import { rollbackBatch } from '../../migration/rollback';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => { await disconnect(); });
const CUTOVER = new Date('2026-01-01T00:00:00.000Z');

async function commitSmall(orgId: string) {
  const batch = await createBatch(orgId, CUTOVER, null);
  const c = await resolveControlCodes(orgId);
  await stageEntity(orgId, batch.id, 'customers', [{ name: 'PT Andi' }]);
  await stageEntity(orgId, batch.id, 'opening-journal', [
    { accountCode: c.AR, debit: 10_000_000, credit: 0 },
    { accountCode: c.OPENING_EQUITY, debit: 0, credit: 10_000_000 },
  ]);
  await stageEntity(orgId, batch.id, 'opening-invoices', [
    { customerName: 'PT Andi', issueDate: '2025-12-01', amount: 10_000_000 },
  ]);
  await commitBatch(orgId, batch.id, null);
  return batch.id;
}

describe('migration rollback', () => {
  it('removes every stamped record and marks the batch ROLLED_BACK', async () => {
    const org = await createTestOrg();
    const batchId = await commitSmall(org.id);
    const res = await rollbackBatch(org.id, batchId);
    expect(res.rolledBack).toBe(true);
    expect(await prisma.customer.count({ where: { organizationId: org.id, migrationBatchId: batchId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.id, migrationBatchId: batchId } })).toBe(0);
    const b = await prisma.migrationBatch.findUnique({ where: { id: batchId } });
    expect(b!.status).toBe('ROLLED_BACK');
    await cleanupOrg(org.id);
  });

  it('is blocked when a non-migration transaction was posted after cutover', async () => {
    const org = await createTestOrg();
    const batchId = await commitSmall(org.id);
    // A real, later journal NOT belonging to the batch:
    await prisma.journalEntry.create({
      data: {
        organizationId: org.id, entryNo: 'JE-999999', date: new Date('2026-02-01'),
        memo: 'real activity', source: 'MANUAL', status: 'POSTED',
        totalDebit: 0, totalCredit: 0, postedAt: new Date('2026-02-01'),
      },
    });
    const res = await rollbackBatch(org.id, batchId);
    expect(res.rolledBack).toBe(false);
    expect(res.reason).toMatch(/posted/i);
    await cleanupOrg(org.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:int -- migration-rollback`
Expected: FAIL — "Cannot find module '../../migration/rollback'".

- [ ] **Step 3: Implement rollback with the guard**

```ts
// lib/migration/rollback.ts
import { prisma } from '@/lib/prisma';
import { getBatch } from './batch-service';

export async function rollbackBatch(orgId: string, batchId: string) {
  const batch = await getBatch(orgId, batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'COMMITTED') throw new Error('Only a committed batch can be rolled back');

  // Guard: any POSTED journal NOT belonging to this batch, dated on/after cutover,
  // means the books are already in use — refuse.
  const foreignActivity = await prisma.journalEntry.count({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      date: { gte: batch.cutoverDate },
      migrationBatchId: { not: batchId },
    },
  });
  if (foreignActivity > 0) {
    return { rolledBack: false, reason: 'Transactions were already posted after the cutover date; rollback is blocked.' };
  }

  await prisma.$transaction(async (tx) => {
    const where = { organizationId: orgId, migrationBatchId: batchId };
    // Reverse dependency order: subledger/lots → journal → master data.
    await tx.inventoryLedgerEntry.deleteMany({ where });
    await tx.inventoryLot.deleteMany({ where });
    await tx.salesInvoice.deleteMany({ where });
    await tx.bill.deleteMany({ where });
    await tx.journalEntry.deleteMany({ where }); // JournalLine cascades on JE delete
    await tx.item.deleteMany({ where });
    await tx.customer.deleteMany({ where });
    await tx.vendor.deleteMany({ where });
    await tx.account.deleteMany({ where });
    await tx.migrationBatch.update({ where: { id: batchId }, data: { status: 'ROLLED_BACK' } });
  });

  return { rolledBack: true };
}
```

> Confirm `JournalLine` (and invoice/bill lines) are declared `onDelete: Cascade` from their parent in `schema.prisma`. If any child lacks a cascade, add an explicit `deleteMany` for it before the parent delete.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:int -- migration-rollback`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/migration/rollback.ts lib/__tests__/integration/migration-rollback.int.test.ts
git commit -m "feat(migration): rollback service with post-cutover activity guard"
```

---

## Task 7: Chart-of-Accounts parent hierarchy on import

**Files:**
- Modify: `lib/migration/commit.ts` (account creation block)
- Test: extend `lib/__tests__/integration/migration-commit.int.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('links imported child accounts to their parent by code', async () => {
  const org = await createTestOrg();
  const batch = await createBatch(org.id, CUTOVER, null);
  await stageEntity(org.id, batch.id, 'accounts', [
    { code: '1-1000', name: 'Kas & Bank', type: 'ASSET' },
    { code: '1-1001', name: 'Kas Kecil', type: 'ASSET', parentCode: '1-1000' },
  ]);
  await commitBatch(org.id, batch.id, null);
  const child = await prisma.account.findFirst({ where: { organizationId: org.id, code: '1-1001' } });
  const parent = await prisma.account.findFirst({ where: { organizationId: org.id, code: '1-1000' } });
  expect(child!.parentId).toBe(parent!.id);
});
```

> Confirm the `Account` model's self-relation field name (`parentId`) in `schema.prisma`; match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:int -- migration-commit`
Expected: FAIL — `child.parentId` is null.

- [ ] **Step 3: Implement two-pass account creation**

In the commit transaction's account block: first create all accounts (parent-less), collect a `code → id` map, then a second pass `update`s each row that has a `parentCode` to set `parentId` from the map. Skip codes that already exist (mirror the existing route's duplicate handling).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:int -- migration-commit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/migration/commit.ts lib/__tests__/integration/migration-commit.int.test.ts
git commit -m "feat(migration): preserve chart-of-accounts parent hierarchy on import"
```

---

## Task 8: API routes + RBAC

**Files:**
- Create: `src/app/api/v1/migration/batches/route.ts`
- Create: `src/app/api/v1/migration/batches/[id]/route.ts`
- Create: `src/app/api/v1/migration/batches/[id]/stage/route.ts`
- Create: `src/app/api/v1/migration/batches/[id]/reconcile/route.ts`
- Create: `src/app/api/v1/migration/batches/[id]/commit/route.ts`
- Create: `src/app/api/v1/migration/batches/[id]/rollback/route.ts`
- Test: `src/app/api/v1/__tests__/migration-routes.test.ts` (follow the existing route-test pattern in that folder)

- [ ] **Step 1: Write a route smoke test**

Mirror an existing test in `src/app/api/v1/__tests__/` (e.g. `reports.test.ts`) for auth + happy path: POST create batch → 200 with id; POST stage customers → 200; GET reconcile → 200 with a `checks` array. Use the same test harness/mocks those tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/v1/__tests__/migration-routes.test.ts`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement the routes**

Each route: `export const runtime = 'nodejs'`, `OPTIONS` returns `corsPreflightResponse()`, and the handler is wrapped with `withPermission({ module: 'SETTINGS', action: 'create' }, …)` (same gate the import route uses), calling `requireOrg(req)` then delegating to the `lib/migration/*` services. `reconcile` computes the preview by calling `reconcileMigration` with the batch's staged data + `resolveControlCodes`. Return via `ok(...)`. Example (create + list):

```ts
// src/app/api/v1/migration/batches/route.ts
import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { createBatch, listBatches } from '@/lib/migration/batch-service';

export const runtime = 'nodejs';
export function OPTIONS() { return corsPreflightResponse(); }

export const POST = withPermission({ module: 'SETTINGS', action: 'create' },
  async (req: NextRequest) => {
    const orgId = requireOrg(req);
    const body = await req.json() as { cutoverDate: string };
    const batch = await createBatch(orgId, new Date(body.cutoverDate), null);
    return ok(batch);
  });

export const GET = withPermission({ module: 'SETTINGS', action: 'read' },
  async (req: NextRequest) => ok(await listBatches(requireOrg(req))));
```

> Confirm `withPermission`'s exact import path and signature against `src/app/api/v1/import/[entity]/route.ts` (it imports from `@/lib/authz` there) and match it for every route.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/v1/__tests__/migration-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Full typecheck + test sweep**

Run: `npx prisma generate && npx tsc --noEmit && npm test && npm run test:int -- migration`
Expected: no type errors; all migration unit + integration tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/migration src/app/api/v1/__tests__/migration-routes.test.ts
git commit -m "feat(migration): API routes for batch create/stage/reconcile/commit/rollback"
```

---

## Deployment note

This plan adds the `MigrationBatch` model + `migrationBatchId` columns → **run the Prisma migration at deploy** (`prisma migrate deploy`), consistent with the repo's Prisma Migrate baseline. No data backfill needed (all new columns nullable).

## What Plan 2 (wizard UI) will build on top

The stepper UI, xlsx upload + column-mapping screen (reusing `src/utils/shopeeImport.ts` parsing and the mapping pattern from `ImportInvoicesModal.tsx`), the Review & Reconcile screen (renders `GET reconcile`'s `checks`), the Done screen (renders the post-commit TB verification), and the rollback button — all driven by the Task 8 routes.
