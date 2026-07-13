# Tipe Penjualan (Sales Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every sale with a configurable Sales Type (offline/online channel), auto-assigned from the sale's source, optionally adding a % service charge at POS, and report revenue split by type.

**Architecture:** New org-scoped `SalesType` master data + `salesTypeId` FK on `SalesInvoice`, with defaults on `PosRegister` and `EcommerceConnection`. POS checkout resolves the type, sets `taxEnabled` from it, and (when charge% > 0) adds a `SalesInvoiceCharge` row — reusing the existing `invoice-send-posting` charge path (no new GL code). Marketplace import stamps the connection's type. A `sales-by-type` report groups invoices by type.

**Tech Stack:** Next.js App Router API, Prisma + PostgreSQL (Prisma Migrate), Zod (`types/api.ts`), Vitest (unit + integration), React (POS PWA `src/pos/`, back-office `src/views`, hooks `src/hooks`), RBAC `withPermission` (`POS_RETAIL`; frontend `pos_retail`).

**Spec:** `docs/superpowers/specs/2026-07-13-tipe-penjualan-design.md`
**Reference implementations (already in this branch):** POS Modifiers — mirror `src/app/api/v1/modifier-groups/route.ts` (CRUD), `src/hooks/useModifiers.ts` (query hooks), `src/views/pos/ModifierSettings.tsx` (settings screen), `lib/pos/modifier-lines.ts` (pure helper + test), `lib/pos/sale-posting.ts` (POS posting), `lib/__tests__/integration/pos-modifiers.int.test.ts` (integration).

**Env note:** Disk is near-full; full `npx tsc --noEmit` is very slow — verify with targeted `npx vitest run <file>` and pattern-matching, not full typechecks. CI runs the full typecheck. Integration tests: `npx vitest run -c vitest.integration.config.ts <file>`; sync the test DB first with `npm run test:int:setup` (recreates `<db>_test` + `migrate deploy`).

---

## File Structure

**Create**
- `lib/pos/sales-type-charge.ts` — pure service-charge math + test
- `src/app/api/v1/sales-types/route.ts` + `[id]/route.ts` — CRUD
- `src/app/api/v1/reports/sales/by-type/route.ts` — report endpoint
- `src/hooks/useSalesTypes.ts` — React Query hooks
- `src/views/pos/SalesTypeSettings.tsx` — settings screen
- `src/views/reports/SalesByType.tsx` — report view
- `lib/__tests__/integration/sales-types.int.test.ts` — integration

**Modify**
- `prisma/schema.prisma` — `SalesType` model, `SalesChannel` enum, `salesTypeId`/`defaultSalesTypeId` FKs + back-relations; new migration under `prisma/migrations/`
- `types/api.ts` — Zod schemas; add `salesTypeId` to POS sale schema; add default fields to register/integration schemas
- `lib/pos/sale-posting.ts` — resolve type, set taxEnabled, add service charge, set salesTypeId
- `lib/marketplace-import.ts` — stamp `connection.salesTypeId` on created invoices
- `src/app/api/v1/pos/registers/route.ts` — accept/persist `defaultSalesTypeId`
- `src/app/api/v1/integrations/[id]/route.ts` — accept/persist `salesTypeId`
- `src/pos/hooks/usePos.ts` / `useOfflinePos.ts`, `src/pos/views/CheckoutView.tsx` — sales-type selector + payload
- `src/views/ar/InvoiceForm.tsx` — optional sales-type picker
- `src/App.tsx` + `src/components/Layout/Sidebar.tsx` + `src/stores/useAccessStore.ts` — route + nav for settings & report
- `prisma/seed.ts` — starter types

---

## Task 1: Prisma schema + migration

**Files:** Modify `prisma/schema.prisma`; create migration.

- [ ] **Step 1: Add enum + model** (near the other POS models):

```prisma
enum SalesChannel {
  OFFLINE
  ONLINE
}

model SalesType {
  id               String       @id @default(cuid())
  organizationId   String
  name             String
  channel          SalesChannel @default(OFFLINE)
  serviceChargePct Decimal      @default(0) @db.Decimal(5, 2)
  chargeAccountId  String?
  taxable          Boolean      @default(true)
  sortOrder        Int          @default(0)
  isActive         Boolean      @default(true)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  organization  Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  chargeAccount Account?              @relation("SalesTypeChargeAccount", fields: [chargeAccountId], references: [id], onDelete: SetNull)
  invoices      SalesInvoice[]
  registers     PosRegister[]
  connections   EcommerceConnection[]

  @@unique([organizationId, name])
  @@index([organizationId])
}
```

- [ ] **Step 2: Add FKs to existing models.**
  - `SalesInvoice`: add
    ```prisma
    salesTypeId String?
    salesType   SalesType? @relation(fields: [salesTypeId], references: [id], onDelete: SetNull)
    ```
    and `@@index([salesTypeId])`.
  - `PosRegister`: add
    ```prisma
    defaultSalesTypeId String?
    defaultSalesType   SalesType? @relation(fields: [defaultSalesTypeId], references: [id], onDelete: SetNull)
    ```
  - `EcommerceConnection`: add
    ```prisma
    salesTypeId String?
    salesType   SalesType? @relation(fields: [salesTypeId], references: [id], onDelete: SetNull)
    ```
  - `Organization`: add `salesTypes SalesType[]`.
  - `Account`: add `salesTypeCharges SalesType[] @relation("SalesTypeChargeAccount")`.

  (Note: `PosRegister.defaultSalesType`, `EcommerceConnection.salesType`, `SalesInvoice.salesType` all point to `SalesType` via distinct relation fields — Prisma pairs them with the `registers`/`connections`/`invoices` back-relations on `SalesType`. The `chargeAccount` relation is NAMED (`"SalesTypeChargeAccount"`) to disambiguate from any other Account relations.)

- [ ] **Step 3: Generate the migration from schema files** (no DB needed):

```bash
git show origin/main:prisma/schema.prisma > /tmp/base_schema.prisma
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_add_sales_types"
npx prisma migrate diff --from-schema-datamodel /tmp/base_schema.prisma --to-schema-datamodel prisma/schema.prisma --script > "prisma/migrations/${TS}_add_sales_types/migration.sql"
```
Open the generated `migration.sql` and confirm it CREATEs `SalesChannel`, `SalesType` (+ indexes + FKs) and ALTERs `SalesInvoice`/`PosRegister`/`EcommerceConnection` to add the nullable columns + FKs. No DROPs of existing columns.

- [ ] **Step 4: Apply to the test DB + regenerate client:**

```bash
npm run test:int:setup   # recreates <db>_test, migrate deploy applies 0_init + modifiers + sales_types
npx prisma generate
```
Expected: "All migrations have been successfully applied." including `..._add_sales_types`; client exposes `prisma.salesType`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(sales-type): schema + migration for SalesType + salesTypeId FKs"
```

---

## Task 2: Types + Zod schemas

**Files:** Modify `types/api.ts`, `lib/pos/pricing.ts` (if the POS sale line/input type lives there) — the POS **sale** schema is `createPosSaleSchema` in `types/api.ts`.

- [ ] **Step 1: Add Zod schemas** in `types/api.ts` (mirror `modifierGroupInputSchema` style):

```ts
export const salesTypeInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  channel: z.enum(['OFFLINE', 'ONLINE']).default('OFFLINE'),
  serviceChargePct: z.number().min(0).max(100).default(0),
  chargeAccountId: z.string().nullish(),
  taxable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
```

- [ ] **Step 2: Thread `salesTypeId` into the POS sale schema.** Find `createPosSaleSchema` in `types/api.ts`; add to its top-level object (not the line object):
```ts
  salesTypeId: z.string().nullish(),
```

- [ ] **Step 3: Add default fields to register + integration update schemas.** Find the register input schema (used by `pos/registers/route.ts`) and add `defaultSalesTypeId: z.string().nullish()`. Find the integration/connection update schema (used by `integrations/[id]/route.ts`) and add `salesTypeId: z.string().nullish()`. (Grep `types/api.ts` for `register`/`ecommerce`/`connection` schema names; if the register route validates inline, add the field there.)

- [ ] **Step 4: Sanity check** by running an existing types-dependent unit test (fast), e.g. `npx vitest run lib/pos/__tests__/pricing.test.ts`. Expected: PASS (no type regressions surface at runtime).

- [ ] **Step 5: Commit**

```bash
git add types/api.ts lib/pos/pricing.ts
git commit -m "feat(sales-type): zod schemas + salesTypeId on POS/register/connection payloads"
```

---

## Task 3: Service-charge math helper (pure, TDD)

**Files:** Create `lib/pos/sales-type-charge.ts`; test `lib/pos/__tests__/sales-type-charge.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeServiceCharge } from '../sales-type-charge';

describe('computeServiceCharge', () => {
  it('returns zero when pct is 0', () => {
    expect(computeServiceCharge({ goodsTotal: 100000, pct: 0, taxable: true, rate: 11 }))
      .toEqual({ chargeAmt: 0, taxAddon: 0 });
  });

  it('taxable charge: amount = pct% of goods total; taxAddon splits embedded PPN out', () => {
    const r = computeServiceCharge({ goodsTotal: 100000, pct: 1, taxable: true, rate: 11 });
    expect(r.chargeAmt).toBe(1000);                 // 1% of 100000
    // embedded tax in a tax-inclusive 1000 at 11% = 1000 - 1000/1.11 = 99.10
    expect(r.taxAddon).toBeCloseTo(99.1, 1);
  });

  it('non-taxable charge: no tax added', () => {
    const r = computeServiceCharge({ goodsTotal: 100000, pct: 2, taxable: false, rate: 11 });
    expect(r.chargeAmt).toBe(2000);
    expect(r.taxAddon).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL**  `npx vitest run lib/pos/__tests__/sales-type-charge.test.ts`

- [ ] **Step 3: Implement**

```ts
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ServiceChargeInput { goodsTotal: number; pct: number; taxable: boolean; rate: number; }
export interface ServiceChargeResult { chargeAmt: number; taxAddon: number; }

/**
 * Service charge for a sales type. chargeAmt = pct% of the (tax-inclusive) goods total.
 * When taxable, taxAddon is the PPN already embedded in chargeAmt (split out for the invoice's
 * taxAmount, exactly how invoice-send-posting expects a tax-inclusive charge). Non-taxable → 0.
 */
export function computeServiceCharge({ goodsTotal, pct, taxable, rate }: ServiceChargeInput): ServiceChargeResult {
  if (pct <= 0) return { chargeAmt: 0, taxAddon: 0 };
  const chargeAmt = round2(goodsTotal * pct / 100);
  const taxAddon = taxable && rate > 0 ? round2(chargeAmt - chargeAmt / (1 + rate / 100)) : 0;
  return { chargeAmt, taxAddon };
}
```

- [ ] **Step 4: Run → PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pos/sales-type-charge.ts lib/pos/__tests__/sales-type-charge.test.ts
git commit -m "feat(sales-type): pure service-charge math helper"
```

---

## Task 4: Wire sales type + charge into POS checkout

**Files:** Modify `lib/pos/sale-posting.ts`. Test: extend `lib/__tests__/integration/sales-types.int.test.ts` (created in Task 10's integration, but write the checkout case here — create the file if absent).

- [ ] **Step 1: Extend `PosSaleInput`** in `lib/pos/sale-posting.ts` with `salesTypeId?: string | null;`.

- [ ] **Step 2: Resolve the type + apply.** In `postPosSale`, after register validation and after computing `const totals = computeSaleTotals(materialized, TAX_RATE);`:

```ts
import { computeServiceCharge } from './sales-type-charge';

// Resolve sales type: explicit → register default → none.
const salesTypeId = input.salesTypeId ?? register.defaultSalesTypeId ?? null;
let salesType: { id: string; taxable: boolean; serviceChargePct: number; chargeAccountId: string | null; name: string } | null = null;
if (salesTypeId) {
  const st = await tx.salesType.findFirst({
    where: { id: salesTypeId, organizationId: orgId },
    select: { id: true, taxable: true, serviceChargePct: true, chargeAccountId: true, name: true },
  });
  if (st) salesType = { ...st, serviceChargePct: Number(st.serviceChargePct) };
}
const taxable = salesType ? salesType.taxable : true;

// Service charge (only when > 0).
const { chargeAmt, taxAddon } = salesType
  ? computeServiceCharge({ goodsTotal: totals.totalAmount, pct: salesType.serviceChargePct, taxable, rate: TAX_RATE })
  : { chargeAmt: 0, taxAddon: 0 };
const chargeAccountId = salesType?.chargeAccountId
  ?? resolveAccountDefaultId(accounts, settings, 'otherIncome')   // fallback income account; if null, charge folds into sales revenue (invoice-send-posting handles it)
  ?? null;

const finalTotal = round2(totals.totalAmount + chargeAmt);
const finalTax = taxable ? round2(totals.taxAmount + taxAddon) : totals.taxAmount;
```

(Move the `accounts`/`settings` load ABOVE this block if it currently sits later — they're needed for `resolveAccountDefaultId`. Reuse the existing `resolveAccountDefaultId`/`loadOrgAccountDefaults` already imported in this file; if `'otherIncome'` isn't a known default key, pass the first active INCOME/REVENUE account id or leave null.)

- [ ] **Step 3: Use the final totals + persist.** Update cash validation to use `finalTotal` (replace `totals.totalAmount` in the tender-sufficiency check and `change`). In the `salesInvoice.create` data: set `taxEnabled: taxable`, `taxAmount: finalTax`, `totalAmount: finalTotal`, `salesTypeId`, and add a `charges` create when `chargeAmt > 0`:

```ts
      charges: chargeAmt > 0 ? { create: [{
        lineNo: 1,
        label: `Service Charge (${salesType!.name})`,
        accountId: chargeAccountId,
        amount: chargeAmt,
        taxRate: taxable ? TAX_RATE : 0,
      }] } : undefined,
```

Leave `postInvoiceSend`, FEFO, ARPayment settlement unchanged — but ensure the ARPayment `totalAmount`/allocation uses `finalTotal` (grep for where the payment amount is set and swap `totals.totalAmount` → `finalTotal`). The `change`/tender lines also use `finalTotal`.

- [ ] **Step 4: Integration test** (create `lib/__tests__/integration/sales-types.int.test.ts`; mirror `pos-modifiers.int.test.ts` setup — org, register, open shift, WALK-IN, stocked item). Case: create a `SalesType` (ONLINE, serviceChargePct 1, taxable true, chargeAccount = an income account); set it as `register.defaultSalesTypeId`; run `postPosSale` with a 100000 sale and NO explicit salesTypeId. Assert:
```ts
const inv = await prisma.salesInvoice.findUnique({ where: { id: res.salesInvoiceId }, include: { charges: true } });
expect(inv.salesTypeId).toBe(salesTypeId);
expect(inv.charges).toHaveLength(1);
expect(Number(inv.charges[0].amount)).toBe(1000);
expect(inv.charges[0].accountId).toBe(incomeAccountId);
// GL balances over the whole org
const jl = await prisma.journalLine.findMany({ where: { entry: { organizationId: org.orgId } } });
expect(Math.round((jl.reduce((s,l)=>s+Number(l.debit),0) - jl.reduce((s,l)=>s+Number(l.credit),0))*100)/100).toBe(0);
```
Run: `npm run test:int:setup && npx vitest run -c vitest.integration.config.ts lib/__tests__/integration/sales-types.int.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pos/sale-posting.ts lib/__tests__/integration/sales-types.int.test.ts
git commit -m "feat(sales-type): POS applies type tax + service charge, tags invoice"
```

---

## Task 5: sales-types CRUD API

**Files:** Create `src/app/api/v1/sales-types/route.ts` + `[id]/route.ts`.

- [ ] **Step 1:** Mirror `src/app/api/v1/modifier-groups/route.ts` + `[id]/route.ts` exactly (imports, `withPermission({ module: 'POS_RETAIL', action })` with `view`/`create`/`edit`/`delete`, `runtime='nodejs'`, `OPTIONS`→`corsPreflightResponse()`, `await params`, org-ownership `findFirst` on by-id ops, `logAudit`). GET lists org sales types ordered by `[{ sortOrder: 'asc' }, { name: 'asc' }]`. POST validates `salesTypeInputSchema` (inject `organizationId: orgId`), creates. PUT updates scalar fields. DELETE deletes (FKs are SetNull, so sales keep their history with a null type — safe).

- [ ] **Step 2: Smoke** (if a dev server is already up; otherwise skip): `curl` POST a type, expect 201. Else verify by structural comparison to modifier-groups.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/sales-types
git commit -m "feat(sales-type): sales-types CRUD API"
```

---

## Task 6: Register + connection default-type persistence

**Files:** Modify `src/app/api/v1/pos/registers/route.ts`, `src/app/api/v1/integrations/[id]/route.ts`.

- [ ] **Step 1: Registers** — in the register create/update handler, read `defaultSalesTypeId` from the validated body and include it in the `prisma.posRegister.create`/`update` data. Verify (if set) the referenced type belongs to the org.

- [ ] **Step 2: Connections** — in the integration `[id]` PUT handler, read `salesTypeId` and include it in the `ecommerceConnection.update` data (org-verify the type).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/pos/registers/route.ts src/app/api/v1/integrations/[id]/route.ts
git commit -m "feat(sales-type): persist default sales type on register + connection"
```

---

## Task 7: Marketplace import stamps the connection's type

**Files:** Modify `lib/marketplace-import.ts` (~L177 `salesInvoice.create`). Test: `lib/__tests__/integration/marketplace-import.int.test.ts` (extend).

- [ ] **Step 1: Write/extend the failing test** — seed a connection with a `salesTypeId`, run the import, assert created invoices have `salesTypeId === connection.salesTypeId`. (Mirror the existing marketplace-import int test setup.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — in the `salesInvoice.create` data at ~L177, add `salesTypeId: connection.salesTypeId ?? null` (ensure `salesTypeId` is selected when the connection is loaded).

- [ ] **Step 4: Run → PASS** (`npx vitest run -c vitest.integration.config.ts lib/__tests__/integration/marketplace-import.int.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/marketplace-import.ts lib/__tests__/integration/marketplace-import.int.test.ts
git commit -m "feat(sales-type): marketplace import tags invoices with the connection's type"
```

---

## Task 8: Sales-by-Type report endpoint (TDD integration)

**Files:** Create `src/app/api/v1/reports/sales/by-type/route.ts`. Test: extend `lib/__tests__/integration/sales-types.int.test.ts`.

- [ ] **Step 1: Write the failing test** — seed two types (Offline, Online) + a few posted invoices tagged to each (and one untagged), call the report handler with a date range covering them, assert the response has per-type rows with correct `count` and `gross`, plus an `Untagged` bucket. Key assertion:
```ts
const body = await res.json();
const offline = body.data.find((r) => r.name === 'Toko Offline');
expect(offline.count).toBe(2);
expect(offline.gross).toBe(expectedOfflineGross);
expect(body.data.find((r) => r.id === null).count).toBe(1); // Untagged
```

- [ ] **Step 2: Run → FAIL** (route 404 / undefined).

- [ ] **Step 3: Implement** the route (gate `withPermission({ module: 'POS_RETAIL', action: 'view' })`). Parse `from`/`to` query dates; query:
```ts
const rows = await prisma.salesInvoice.groupBy({
  by: ['salesTypeId'],
  where: { organizationId: orgId, status: { in: ['SENT', 'PAID', 'PARTIAL'] }, issueDate: { gte: from, lte: to } },
  _sum: { totalAmount: true, taxAmount: true },
  _count: { _all: true },
});
```
Load the org's sales types to attach `name`/`channel`; map each row to `{ id, name, channel, count, gross: Number(_sum.totalAmount), netPreTax: Number(_sum.totalAmount) - Number(_sum.taxAmount) }`; the `salesTypeId === null` row becomes `{ id: null, name: 'Untagged', channel: null, ... }`. Return `ok({ data, from, to })`. (Adjust the `status` filter to the actual posted-invoice statuses used in this codebase — grep `InvoiceStatus` enum; use the same non-void/posted set the Sales-Performance report uses.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/reports/sales/by-type/route.ts lib/__tests__/integration/sales-types.int.test.ts
git commit -m "feat(sales-type): sales-by-type report endpoint"
```

---

## Task 9: React Query hook

**Files:** Create `src/hooks/useSalesTypes.ts`.

- [ ] **Step 1:** Mirror `src/hooks/useModifiers.ts` — `SALES_TYPE_KEYS`, `useSalesTypes()` (list; normalize Decimal `serviceChargePct`→Number), `useCreateSalesType()`, `useUpdateSalesType()`, `useDeleteSalesType()` hitting `/api/v1/sales-types`, invalidating on success. Also `useSalesByType(from, to)` hitting `/api/v1/reports/sales/by-type`.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSalesTypes.ts
git commit -m "feat(sales-type): react-query hooks"
```

---

## Task 10: Sales Type settings screen

**Files:** Create `src/views/pos/SalesTypeSettings.tsx`; wire route + nav in `src/App.tsx`, `src/components/Layout/Sidebar.tsx`, `src/stores/useAccessStore.ts`.

- [ ] **Step 1:** Mirror `src/views/pos/ModifierSettings.tsx`: a CRUD list of sales types — columns name, channel (Offline/Online), service charge %, taxable, active. Create/Edit modal: name, channel toggle, serviceChargePct number input ("Service charge %"), charge account picker (reuse the account-select hook used elsewhere — grep how `chargeAccountId`/account pickers are done, e.g. in payment or charge UIs), taxable checkbox, sortOrder, active. Delete with confirm. Indonesian labels ("Tipe Penjualan", "Saluran", "Biaya Layanan %", "Kena Pajak").

- [ ] **Step 2:** Add lazy route `pos/sales-types` in `src/App.tsx` wrapped in `withPermission(<SalesTypeSettings/>, 'pos_retail')`; add a "Tipe Penjualan" item under the "Point of Sale" sidebar group; add `'/pos/sales-types': 'pos_retail'` to `SUBITEM_PERMISSION_MAP` and ensure the group lists `pos_retail`. (If `pos_retail` isn't in `MODULE_KEYS` yet — the parallel RBAC task adds it — use the same key `ModifierSettings` currently uses and leave a `// TODO: switch to pos_retail` note.)

- [ ] **Step 3: Manual verify** (if dev server up): create "Toko Offline" (0%) + "Online" (ONLINE, 1%), reload, confirm persistence.

- [ ] **Step 4: Commit**

```bash
git add src/views/pos/SalesTypeSettings.tsx src/App.tsx src/components/Layout/Sidebar.tsx src/stores/useAccessStore.ts
git commit -m "feat(sales-type): back-office settings screen + nav"
```

---

## Task 11: Default-type selects on register + integration forms

**Files:** Modify the register settings form and the integration/connection form (grep `defaultSalesTypeId` targets — find where a register is edited in the UI, e.g. an outlet/register settings view, and the integration edit form).

- [ ] **Step 1:** Add a "Default sales type" `<select>` (options from `useSalesTypes()`) to the register edit form; bind to `defaultSalesTypeId`; include it in the save payload.
- [ ] **Step 2:** Add the same select to the marketplace connection form, bound to `salesTypeId`.
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(sales-type): default-type pickers on register + connection forms"
```

(If a register-edit UI does not exist yet, state that in the report and limit this task to the connection form + note the register default can be set via API until a register-edit UI lands.)

---

## Task 12: POS checkout sales-type selector

**Files:** Modify `src/pos/hooks/usePos.ts`, `src/pos/hooks/useOfflinePos.ts`, `src/pos/views/CheckoutView.tsx`, and the POS bootstrap/catalog payload (`src/app/api/v1/pos/catalog/route.ts` or the POS bootstrap route) to include the org's active sales types + the register default.

- [ ] **Step 1:** Extend the POS bootstrap/catalog response with `salesTypes` (id, name, channel, serviceChargePct, taxable) and the register's `defaultSalesTypeId`. Cache them offline (mirror how catalog/registers are cached in `src/pos/offline/db.ts`).
- [ ] **Step 2:** In `CheckoutView`, add a sales-type selector defaulting to the register default; show the resulting service charge in the displayed total (compute client-side with `computeServiceCharge` for display only). Put the chosen `salesTypeId` into the sale POST payload.
- [ ] **Step 3: Manual verify** (dev server): pick "Online 1%" → total shows +1% → checkout → invoice has the charge + salesTypeId (server authoritative). Offline: selection uses cached types; syncs correctly.
- [ ] **Step 4: Commit**

```bash
git add src/pos src/app/api/v1/pos/catalog/route.ts
git commit -m "feat(sales-type): POS checkout sales-type selector + offline cache"
```

---

## Task 13: Manual invoice picker + Sales-by-Type report view

**Files:** Modify `src/views/ar/InvoiceForm.tsx`; create `src/views/reports/SalesByType.tsx` + route/nav.

- [ ] **Step 1:** Add an optional "Tipe Penjualan" `<select>` (from `useSalesTypes()`) to `InvoiceForm.tsx`, bound to `salesTypeId`, included in the invoice save payload. Verify the invoice create/update API accepts `salesTypeId` (add to its Zod schema + create/update data if missing — grep the invoices route).
- [ ] **Step 2:** Create `src/views/reports/SalesByType.tsx`: a date-range picker + a table using `useSalesByType(from,to)` showing per-type rows (name, channel, count, gross, net pre-tax) with an online-vs-offline summary. Mirror the Sales-Performance report view. Add route + nav under Reports, gated `pos_retail`.
- [ ] **Step 3: Commit**

```bash
git add src/views/ar/InvoiceForm.tsx src/views/reports/SalesByType.tsx src/App.tsx src/components/Layout/Sidebar.tsx src/stores/useAccessStore.ts
git commit -m "feat(sales-type): manual invoice picker + Sales-by-Type report view"
```

---

## Task 14: Starter types seed + full green

**Files:** Modify `prisma/seed.ts`.

- [ ] **Step 1:** In `prisma/seed.ts`, for each seeded org create two `SalesType`s if none exist: `{ name: 'Toko Offline', channel: 'OFFLINE', serviceChargePct: 0 }` and `{ name: 'Online', channel: 'ONLINE', serviceChargePct: 0 }`. Set the demo register's `defaultSalesTypeId` to the Offline one.
- [ ] **Step 2:** Run the full unit suite + the sales-type integration tests:
  `npx vitest run lib/pos/__tests__/ && npm run test:int:setup && npx vitest run -c vitest.integration.config.ts lib/__tests__/integration/sales-types.int.test.ts lib/__tests__/integration/pos-sale-posting.int.test.ts`
  Expected: all green (POS posting unaffected for the no-type path).
- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(sales-type): seed starter sales types"
```

---

## Self-Review Notes

- **Spec coverage:** managed list + CRUD (Tasks 1,2,5,9,10); channel/charge/taxable fields (Task 1); auto-assign defaults on register + connection (Tasks 1,6,11); POS charge + tax via existing charge path (Tasks 3,4); tag POS + import + manual (Tasks 4,7,13); report (Tasks 8,13); starter seed (Task 14); migration under Prisma Migrate (Task 1). All spec sections mapped.
- **Reuse:** service charge rides on `SalesInvoiceCharge` + `invoice-send-posting` (no new GL code); routes/hooks/settings mirror the merged Modifier feature.
- **Naming consistency:** `SalesType`, `SalesChannel`, `salesTypeId`, `defaultSalesTypeId`, `serviceChargePct`, `taxable`, `chargeAccountId`, `computeServiceCharge`, `useSalesTypes`, `useSalesByType` used consistently across tasks.
- **Dependency:** frontend `pos_retail` permission key comes from the parallel RBAC task; Tasks 10/13 interim-gate + switch if not yet merged.
- **Risk note:** `taxable` is the only field touching the tax computation (sets invoice `taxEnabled`); if `resolveAccountDefaultId` has no income-account key, the charge account may be null — `invoice-send-posting` folds a null-account charge into sales revenue (still balances), so it degrades safely.
