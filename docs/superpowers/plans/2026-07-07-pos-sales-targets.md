# POS Sales Targets by Staff Member — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manager-only monthly sales targets per staff member and a Sales Performance scoreboard to the POS, with sales credited at the line level to an Employee (salon-ready).

**Architecture:** Additive schema (link staff↔login, a per-line performer on the invoice line, a targets table, a new `POS_REPORTS` permission). A pure domain module computes the WIB month window and the per-employee rollup. Two Next.js API routes (report + targets) reuse the existing `withPermission`/org-scoping. A back-office React page under Reports renders the scoreboard and a target editor. The pharmacy till UI is untouched — each line auto-credits the cashier's linked staff record; the salon slice will later fill `performedById` explicitly.

**Tech Stack:** Prisma + PostgreSQL, Next.js App Router API, Vitest (unit + integration), Vite + React 19 + TanStack Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-07-pos-sales-targets-design.md`

---

## File Structure

**Backend**
- `prisma/schema.prisma` — MODIFY: `Employee.userId`, `SalesInvoiceLine.performedById`, new `PosSalesTarget` model, back-relations, new `ModuleKey.POS_REPORTS`.
- `lib/pos/pricing.ts` — MODIFY: add optional `performedById` to `SaleLineInput`.
- `lib/pos/sale-posting.ts` — MODIFY: resolve the cashier's staff record and stamp `performedById` on each invoice line.
- `lib/pos/sales-performance.ts` — CREATE: pure WIB-month + rollup + status functions.
- `types/api.ts` — MODIFY: extend `posSaleLineSchema` with `performedById`; add `putPosTargetsSchema`.
- `src/app/api/v1/pos/reports/sales-performance/route.ts` — CREATE: `GET`.
- `src/app/api/v1/pos/targets/route.ts` — CREATE: `GET` + `PUT`.

**Frontend**
- `src/stores/useAccessStore.ts` — MODIFY: register `pos_reports`.
- `src/hooks/usePosReports.ts` — CREATE: query/mutation hooks.
- `src/views/reports/SalesPerformance.tsx` — CREATE: scoreboard + target editor.
- `src/App.tsx` — MODIFY: lazy import + guarded route.
- `src/components/Layout/Sidebar.tsx` — MODIFY: nav item under Reports.

**Tests**
- `lib/pos/__tests__/sales-performance.test.ts` — CREATE (unit).
- `lib/__tests__/integration/pos-sales-attribution.int.test.ts` — CREATE (integration).
- `lib/__tests__/integration/pos-sales-targets.int.test.ts` — CREATE (integration).

**Commands** (repo root): unit `npm test`; integration `npm run test:int`; types `npm run typecheck`; build `npm run build`.

---

### Task 1: Schema — staff link, per-line performer, targets table, permission

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `userId` + relation to `Employee`**

In `model Employee`, add the scalar field near the other optionals and the relation near the other relations:

```prisma
  userId                String?          @unique
```
```prisma
  user                  User?            @relation(fields: [userId], references: [id], onDelete: SetNull)
  salesTargets          PosSalesTarget[]
  performedLines        SalesInvoiceLine[]
```

- [ ] **Step 2: Add the back-relation to `User`**

In `model User`, add:

```prisma
  employeeProfile   Employee?
```

- [ ] **Step 3: Add `performedById` + relation to `SalesInvoiceLine`**

In `model SalesInvoiceLine`, add the scalar after `lineSubtotal` and the relation next to the `item` relation:

```prisma
  performedById String?
```
```prisma
  performedBy    Employee?    @relation(fields: [performedById], references: [id], onDelete: SetNull)
```

Add an index inside the model's index block:

```prisma
  @@index([performedById])
```

- [ ] **Step 4: Add the `PosSalesTarget` model**

Place it next to the other `Pos*` models:

```prisma
model PosSalesTarget {
  id             String   @id @default(cuid())
  organizationId String
  employeeId     String
  month          String   // "YYYY-MM" (WIB calendar month)
  targetAmount   Decimal  @default(0) @db.Decimal(18, 2)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  employee     Employee     @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@unique([organizationId, employeeId, month])
  @@index([organizationId, month])
}
```

- [ ] **Step 5: Add the back-relation to `Organization` and the enum value**

In `model Organization`, add:

```prisma
  posSalesTargets   PosSalesTarget[]
```

In `enum ModuleKey`, add after `POS_RETAIL`:

```prisma
  POS_REPORTS
```

- [ ] **Step 6: Validate + generate the client**

Run: `cd "/Users/haelykometakiung/Documents/MSM Accounting Software" && npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" and "Generated Prisma Client".

- [ ] **Step 7: Apply the schema to the test database**

Run: `npm run test:int:setup`
Expected: completes without error (the integration test DB, name ending `_test`, now has the `PosSalesTarget` table and new columns). (Dev/prod DB is synced separately at rollout with `npx prisma db push`.)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(pos): schema for staff-linked line attribution + sales targets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Sales-performance domain module (pure, TDD)

**Files:**
- Create: `lib/pos/sales-performance.ts`
- Test: `lib/pos/__tests__/sales-performance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/pos/__tests__/sales-performance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  wibMonthRange,
  saleTargetStatus,
  computeSalesPerformance,
  UNASSIGNED,
} from '../sales-performance';

describe('wibMonthRange', () => {
  it('spans the WIB calendar month as UTC instants', () => {
    const r = wibMonthRange('2026-07', new Date('2026-07-20T00:00:00Z'));
    // WIB midnight 2026-07-01 == 2026-06-30T17:00:00Z
    expect(r.start.toISOString()).toBe('2026-06-30T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(r.daysInMonth).toBe(31);
  });

  it('counts a sale just after WIB midnight on the 1st into the new month', () => {
    const r = wibMonthRange('2026-07', new Date('2026-07-20T00:00:00Z'));
    const justAfterMidnightWib = new Date('2026-06-30T17:30:00.000Z'); // 00:30 WIB Jul 1
    expect(justAfterMidnightWib >= r.start && justAfterMidnightWib < r.end).toBe(true);
  });

  it('reports full days elapsed for a past month and zero for a future one', () => {
    expect(wibMonthRange('2026-07', new Date('2026-09-01T00:00:00Z')).daysElapsed).toBe(31);
    expect(wibMonthRange('2026-07', new Date('2026-05-01T00:00:00Z')).daysElapsed).toBe(0);
  });

  it('rejects a malformed month', () => {
    expect(() => wibMonthRange('2026-13', new Date('2026-07-20T00:00:00Z'))).toThrow();
  });
});

describe('saleTargetStatus', () => {
  it('is green when target met or on pace, amber near pace, red below, null without target', () => {
    expect(saleTargetStatus(100, 100, 50)).toBe('green'); // met
    expect(saleTargetStatus(60, 100, 50)).toBe('green');  // ahead of pace
    expect(saleTargetStatus(46, 100, 50)).toBe('amber');  // >= 0.9*expected
    expect(saleTargetStatus(10, 100, 50)).toBe('red');
    expect(saleTargetStatus(10, 0, 0)).toBeNull();
  });
});

describe('computeSalesPerformance', () => {
  it('rolls up sold per employee, applies targets, and appends an Unassigned row', () => {
    const res = computeSalesPerformance({
      soldByEmployee: { e1: 8000, e2: 3000, [UNASSIGNED]: 500 },
      targets: { e1: 10000, e3: 5000 },
      names: { e1: 'Ani', e2: 'Budi', e3: 'Citra' },
      daysInMonth: 30,
      daysElapsed: 30,
    });
    const ani = res.rows.find((r) => r.employeeId === 'e1')!;
    expect(ani.sold).toBe(8000);
    expect(ani.pct).toBe(80);
    expect(ani.remaining).toBe(2000);
    expect(ani.status).toBe('red'); // 8000 < expected 10000 at full pace, < 0.9*10000
    const citra = res.rows.find((r) => r.employeeId === 'e3')!; // target, no sales
    expect(citra.sold).toBe(0);
    const budi = res.rows.find((r) => r.employeeId === 'e2')!; // sales, no target
    expect(budi.pct).toBeNull();
    const unassigned = res.rows.find((r) => r.employeeId === null)!;
    expect(unassigned.name).toBe('Unassigned');
    expect(unassigned.sold).toBe(500);
    expect(res.totals.sold).toBe(11500);
    expect(res.totals.target).toBe(15000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sales-performance`
Expected: FAIL — cannot resolve `../sales-performance`.

- [ ] **Step 3: Implement the module**

Create `lib/pos/sales-performance.ts`:

```ts
/** Pure domain helpers for the POS Sales Performance report. No DB, no I/O —
 *  so month-boundary and rollup logic is unit-testable in isolation. */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta is UTC+7, no DST
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Sentinel key for line value whose performer is unknown (no explicit
 *  performer and the cashier has no linked staff record). */
export const UNASSIGNED = 'UNASSIGNED';

export type PerfStatus = 'green' | 'amber' | 'red' | null;

export interface MonthRange {
  start: Date;        // UTC instant of WIB month start (inclusive)
  end: Date;          // UTC instant of next WIB month start (exclusive)
  daysInMonth: number;
  daysElapsed: number; // relative to `now`, clamped to [0, daysInMonth]
}

export interface PerfRow {
  employeeId: string | null; // null => the Unassigned bucket
  name: string;
  target: number;            // 0 when none set
  hasTarget: boolean;
  sold: number;
  remaining: number;         // max(0, target - sold); 0 when no target
  pct: number | null;        // null when no target
  status: PerfStatus;
}

export interface PerfResult {
  rows: PerfRow[];
  totals: { target: number; sold: number };
}

/** WIB calendar month for "YYYY-MM", expressed as UTC instants. */
export function wibMonthRange(month: string, now: Date): MonthRange {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const year = Number(m[1]);
  const mon = Number(m[2]); // 1-12
  if (mon < 1 || mon > 12) throw new Error(`Invalid month "${month}"`);

  // Date.UTC(y, mon-1, 1) is UTC midnight; WIB midnight is 7h earlier in UTC.
  const start = new Date(Date.UTC(year, mon - 1, 1) - WIB_OFFSET_MS);
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const end = new Date(Date.UTC(nextYear, nextMon - 1, 1) - WIB_OFFSET_MS);

  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  let daysElapsed: number;
  if (now.getTime() >= end.getTime()) daysElapsed = daysInMonth;
  else if (now.getTime() < start.getTime()) daysElapsed = 0;
  else daysElapsed = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;

  return { start, end, daysInMonth, daysElapsed };
}

/** Colour by pace so mid-month numbers are meaningful. `expected` is the
 *  pro-rated target for the elapsed portion of the month. */
export function saleTargetStatus(sold: number, target: number, expected: number): PerfStatus {
  if (target <= 0) return null;
  if (sold >= target || sold >= expected) return 'green';
  if (sold >= 0.9 * expected) return 'amber';
  return 'red';
}

export function computeSalesPerformance(input: {
  soldByEmployee: Record<string, number>; // keys: employeeId, or UNASSIGNED
  targets: Record<string, number>;         // employeeId -> amount (>0)
  names: Record<string, string>;           // employeeId -> display name
  daysInMonth: number;
  daysElapsed: number;
}): PerfResult {
  const { soldByEmployee, targets, names, daysInMonth, daysElapsed } = input;
  const paceFrac = daysInMonth > 0 ? daysElapsed / daysInMonth : 0;

  const ids = new Set<string>();
  for (const k of Object.keys(soldByEmployee)) if (k !== UNASSIGNED) ids.add(k);
  for (const k of Object.keys(targets)) ids.add(k);

  const rows: PerfRow[] = [];
  for (const id of ids) {
    const sold = round2(soldByEmployee[id] ?? 0);
    const target = targets[id] ?? 0;
    const hasTarget = target > 0;
    const expected = target * paceFrac;
    rows.push({
      employeeId: id,
      name: names[id] ?? 'Unknown',
      target,
      hasTarget,
      sold,
      remaining: hasTarget ? Math.max(0, round2(target - sold)) : 0,
      pct: hasTarget ? round2((sold / target) * 100) : null,
      status: saleTargetStatus(sold, target, expected),
    });
  }
  rows.sort((a, b) => b.sold - a.sold);

  const unassignedSold = round2(soldByEmployee[UNASSIGNED] ?? 0);
  if (unassignedSold > 0) {
    rows.push({
      employeeId: null, name: 'Unassigned', target: 0, hasTarget: false,
      sold: unassignedSold, remaining: 0, pct: null, status: null,
    });
  }

  return {
    rows,
    totals: {
      target: round2(rows.reduce((s, r) => s + r.target, 0)),
      sold: round2(rows.reduce((s, r) => s + r.sold, 0)),
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- sales-performance`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/pos/sales-performance.ts lib/pos/__tests__/sales-performance.test.ts
git commit -m "feat(pos): sales-performance domain (WIB month, rollup, status)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Thread `performedById` through pricing input + zod

**Files:**
- Modify: `lib/pos/pricing.ts`
- Modify: `types/api.ts`

- [ ] **Step 1: Extend `SaleLineInput`**

In `lib/pos/pricing.ts`, add the optional field to the `SaleLineInput` interface (it is ignored by the totals math):

```ts
  /** Staff member (Employee id) credited for this line. Optional: the pharmacy
   *  sends none and the server defaults it to the cashier's staff record. */
  performedById?: string | null;
```

- [ ] **Step 2: Extend the POS sale line zod schema**

In `types/api.ts`, add to `posSaleLineSchema` (after `discountPct`):

```ts
  performedById: z.string().trim().min(1).nullish(),
```

- [ ] **Step 3: Typecheck + existing pricing tests still pass**

Run: `npm run typecheck && npm test -- pricing`
Expected: no type errors; pricing tests PASS (unchanged totals).

- [ ] **Step 4: Commit**

```bash
git add lib/pos/pricing.ts types/api.ts
git commit -m "feat(pos): accept optional per-line performedById on sale input

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Stamp `performedById` on invoice lines at checkout (TDD, integration)

**Files:**
- Modify: `lib/pos/sale-posting.ts`
- Test: `lib/__tests__/integration/pos-sales-attribution.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/__tests__/integration/pos-sales-attribution.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';

afterAll(async () => { await disconnect(); });

/** A service org: a non-stock SERVICE item, walk-in customer, COGS + PPN
 *  accounts, a register and an open shift keyed to a cashier user id. */
async function setup(cashierUserId: string): Promise<{ org: TestOrg; itemId: string; registerId: string; shiftId: string }> {
  const org = await createTestOrg({ costingMethod: 'FIFO' });
  await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.orgId, code: '5100' } },
    update: {},
    create: { organizationId: org.orgId, code: '5100', name: 'COGS', type: 'EXPENSE', normalSide: 'DEBIT' },
  });
  await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.orgId, code: '2130' } },
    update: {},
    create: { organizationId: org.orgId, code: '2130', name: 'Output Tax Payable (PPN)', type: 'LIABILITY', normalSide: 'CREDIT' },
  });
  await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in' } });
  const item = await prisma.item.create({
    data: { organizationId: org.orgId, sku: `SVC-${Date.now()}`, name: 'Haircut', type: 'SERVICE', sellingPrice: 50000, requiresBatchTracking: false },
    select: { id: true },
  });
  const register = await prisma.posRegister.create({
    data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId },
    select: { id: true },
  });
  const shift = await prisma.posShift.create({
    data: { organizationId: org.orgId, registerId: register.id, cashierId: cashierUserId, openingFloat: 0, status: 'OPEN' },
    select: { id: true },
  });
  return { org, itemId: item.id, registerId: register.id, shiftId: shift.id };
}

function saleInput(o: { itemId: string; registerId: string; shiftId: string }, cashierId: string, clientSaleId: string, performedById?: string): PosSaleInput {
  return {
    clientSaleId, registerId: o.registerId, shiftId: o.shiftId, cashierId, warehouseId: null,
    lines: [{ itemId: o.itemId, description: 'Haircut', quantity: 1, price: 50000, discountPct: 0, performedById }],
    tenders: [{ method: 'CASH', amount: 50000 }],
    date: new Date('2026-07-10T05:00:00Z'),
  };
}

describe('POS line attribution', () => {
  it('defaults each line to the cashier\'s linked staff record', async () => {
    const user = await prisma.user.create({ data: { email: `cash-${Date.now()}@x.com`, fullName: 'Cashier', passwordHash: 'x' }, select: { id: true } });
    const o = await setup(user.id);
    const emp = await prisma.employee.create({
      data: { organizationId: o.org.orgId, employeeNo: `E-${Date.now()}`, name: 'Ani', joinDate: new Date('2026-01-01'), userId: user.id },
      select: { id: true },
    });
    const res = await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, saleInput(o, user.id, 'attr-default')));
    const line = await prisma.salesInvoiceLine.findFirst({ where: { invoiceId: res.salesInvoiceId }, select: { performedById: true } });
    expect(line?.performedById).toBe(emp.id);
    await cleanupOrg(o.org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it('honors an explicit per-line performer and leaves it null when the cashier has no staff record', async () => {
    const user = await prisma.user.create({ data: { email: `cash2-${Date.now()}@x.com`, fullName: 'Cashier2', passwordHash: 'x' }, select: { id: true } });
    const o = await setup(user.id); // NOTE: no Employee linked to this user
    const stylist = await prisma.employee.create({
      data: { organizationId: o.org.orgId, employeeNo: `S-${Date.now()}`, name: 'Budi', joinDate: new Date('2026-01-01') },
      select: { id: true },
    });
    const explicit = await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, saleInput(o, user.id, 'attr-explicit', stylist.id)));
    const l1 = await prisma.salesInvoiceLine.findFirst({ where: { invoiceId: explicit.salesInvoiceId }, select: { performedById: true } });
    expect(l1?.performedById).toBe(stylist.id);

    const none = await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, saleInput(o, user.id, 'attr-none')));
    const l2 = await prisma.salesInvoiceLine.findFirst({ where: { invoiceId: none.salesInvoiceId }, select: { performedById: true } });
    expect(l2?.performedById).toBeNull();

    await cleanupOrg(o.org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:int -- pos-sales-attribution`
Expected: FAIL — `performedById` is always `null` (server doesn't set it yet).

- [ ] **Step 3: Implement default performer resolution**

In `lib/pos/sale-posting.ts`, immediately **before** the `// 6. Create SalesInvoice` block, insert:

```ts
  // 5b. Resolve the staff member each line is credited to. A line's explicit
  //     performedById wins; otherwise credit the cashier's linked staff record
  //     (Employee.userId === cashierId); otherwise null (Unassigned).
  const cashierEmployee = await tx.employee.findFirst({
    where: { organizationId: orgId, userId: input.cashierId },
    select: { id: true },
  });
  const defaultPerformerId = cashierEmployee?.id ?? null;
```

Then in the invoice `lines.create` map, add `performedById` to each created line:

```ts
        create: input.lines.map((l, i) => ({
          lineNo: i + 1,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          price: l.price,
          discountPct: l.discountPct ?? 0,
          lineSubtotal: round2(l.quantity * l.price * (1 - (l.discountPct ?? 0) / 100)),
          performedById: l.performedById ?? defaultPerformerId,
        })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:int -- pos-sales-attribution`
Expected: PASS (both cases).

- [ ] **Step 5: Guard against regressions in the existing sale posting**

Run: `npm run test:int -- pos-sale-posting`
Expected: PASS (attribution is additive; totals/AR/FEFO unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/pos/sale-posting.ts lib/__tests__/integration/pos-sales-attribution.int.test.ts
git commit -m "feat(pos): credit each sale line to the cashier's staff record

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Targets API — GET + PUT (TDD, integration)

**Files:**
- Create: `src/app/api/v1/pos/targets/route.ts`
- Modify: `types/api.ts`
- Test: `lib/__tests__/integration/pos-sales-targets.int.test.ts`

- [ ] **Step 1: Add the PUT payload schema**

In `types/api.ts`, near the other POS schemas, add:

```ts
export const putPosTargetsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  targets: z.array(z.object({
    employeeId: z.string().trim().min(1),
    targetAmount: z.number().nonnegative().nullable(),
  })),
});
```

- [ ] **Step 2: Write the failing integration test**

Create `lib/__tests__/integration/pos-sales-targets.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { GET as getTargets, PUT as putTargets } from '@/src/app/api/v1/pos/targets/route';

afterAll(async () => { await disconnect(); });

function adminReq(orgId: string, url: string, init?: RequestInit) {
  return new NextRequest(url, {
    ...init,
    headers: { 'x-org-id': orgId, 'x-user-id': 'admin', 'x-role-type': 'ADMIN', 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function makeEmployee(orgId: string, name: string) {
  return prisma.employee.create({
    data: { organizationId: orgId, employeeNo: `E-${name}-${Date.now()}`, name, joinDate: new Date('2026-01-01') },
    select: { id: true },
  });
}

describe('POS targets API', () => {
  it('upserts, lists, and clears monthly targets', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const ani = await makeEmployee(org.orgId, 'Ani');
    const budi = await makeEmployee(org.orgId, 'Budi');

    const putRes = await putTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets', {
      method: 'PUT',
      body: JSON.stringify({ month: '2026-07', targets: [
        { employeeId: ani.id, targetAmount: 5000000 },
        { employeeId: budi.id, targetAmount: 4000000 },
      ] }),
    }));
    expect(putRes.status).toBe(200);

    const listRes = await getTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets?month=2026-07'));
    const list = await listRes.json();
    const aniRow = list.targets.find((t: any) => t.employeeId === ani.id);
    expect(aniRow.targetAmount).toBe(5000000);
    expect(list.targets.some((t: any) => t.employeeId === budi.id && t.targetAmount === 4000000)).toBe(true);

    // Clear Budi's target with null.
    await putTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets', {
      method: 'PUT',
      body: JSON.stringify({ month: '2026-07', targets: [{ employeeId: budi.id, targetAmount: null }] }),
    }));
    const after = await (await getTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets?month=2026-07'))).json();
    expect(after.targets.find((t: any) => t.employeeId === budi.id).targetAmount).toBeNull();

    await cleanupOrg(org.orgId);
  });

  it('rejects a caller without POS_REPORTS with 403', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const role = await prisma.role.create({
      data: { organizationId: org.orgId, name: 'No Reports', roleType: 'CUSTOM',
        permissions: { create: [{ moduleKey: 'DASHBOARD', canView: true }] } },
      select: { id: true, roleType: true },
    });
    const user = await prisma.user.create({ data: { email: `nr-${Date.now()}@x.com`, fullName: 'NR', passwordHash: 'x' }, select: { id: true } });
    await prisma.userOrganization.create({ data: { userId: user.id, organizationId: org.orgId, roleId: role.id, isActive: true } });

    const req = new NextRequest('http://localhost/api/v1/pos/targets?month=2026-07', {
      headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': role.roleType },
    });
    const res = await getTargets(req);
    expect(res.status).toBe(403);

    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it('does not upsert a target for another org\'s employee', async () => {
    const orgA = await createTestOrg({ costingMethod: 'FIFO' });
    const orgB = await createTestOrg({ costingMethod: 'FIFO' });
    const foreign = await makeEmployee(orgB.orgId, 'Foreign');
    await putTargets(adminReq(orgA.orgId, 'http://localhost/api/v1/pos/targets', {
      method: 'PUT',
      body: JSON.stringify({ month: '2026-07', targets: [{ employeeId: foreign.id, targetAmount: 999 }] }),
    }));
    const count = await prisma.posSalesTarget.count({ where: { organizationId: orgA.orgId } });
    expect(count).toBe(0);
    await cleanupOrg(orgA.orgId);
    await cleanupOrg(orgB.orgId);
  });
});
```

- [ ] **Step 2b: Run the test to verify it fails**

Run: `npm run test:int -- pos-sales-targets`
Expected: FAIL — cannot resolve the targets route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/pos/targets/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { putPosTargetsSchema } from '@/types/api';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

/** List active staff for the org and each one's target for the month. */
export const GET = withPermission({ module: 'POS_REPORTS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return err('month=YYYY-MM is required', 400);

  const employees = await prisma.employee.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const targetRows = await prisma.posSalesTarget.findMany({
    where: { organizationId: orgId, month },
    select: { employeeId: true, targetAmount: true },
  });
  const byEmp = new Map(targetRows.map((t) => [t.employeeId, Number(t.targetAmount)]));

  return ok({
    month,
    targets: employees.map((e) => ({ employeeId: e.id, name: e.name, targetAmount: byEmp.get(e.id) ?? null })),
  });
});

/** Bulk upsert targets for a month. A null/zero amount clears the row. */
export const PUT = withPermission({ module: 'POS_REPORTS', action: 'edit' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const parsed = putPosTargetsSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid targets payload', 400);
  const { month, targets } = parsed.data;

  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      // Fail-closed: ignore ids that are not this org's employees.
      const emp = await tx.employee.findFirst({ where: { id: t.employeeId, organizationId: orgId }, select: { id: true } });
      if (!emp) continue;
      if (t.targetAmount == null || t.targetAmount <= 0) {
        await tx.posSalesTarget.deleteMany({ where: { organizationId: orgId, employeeId: t.employeeId, month } });
      } else {
        await tx.posSalesTarget.upsert({
          where: { organizationId_employeeId_month: { organizationId: orgId, employeeId: t.employeeId, month } },
          update: { targetAmount: t.targetAmount },
          create: { organizationId: orgId, employeeId: t.employeeId, month, targetAmount: t.targetAmount },
        });
      }
    }
  });
  return ok({ ok: true });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:int -- pos-sales-targets`
Expected: PASS (upsert/list/clear, 403, cross-org).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/pos/targets/route.ts types/api.ts lib/__tests__/integration/pos-sales-targets.int.test.ts
git commit -m "feat(pos): targets API (GET list, PUT upsert) gated by POS_REPORTS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Sales Performance report API (TDD, integration)

**Files:**
- Create: `src/app/api/v1/pos/reports/sales-performance/route.ts`
- Test: extend `lib/__tests__/integration/pos-sales-targets.int.test.ts` with a report block (or a sibling file `pos-sales-performance.int.test.ts`).

- [ ] **Step 1: Write the failing integration test**

Create `lib/__tests__/integration/pos-sales-performance.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';
import { postPosSale } from '@/lib/pos/sale-posting';
import { GET as report } from '@/src/app/api/v1/pos/reports/sales-performance/route';

afterAll(async () => { await disconnect(); });

async function serviceOrg(): Promise<{ org: TestOrg; itemId: string; registerId: string; shiftId: string }> {
  const org = await createTestOrg({ costingMethod: 'FIFO' });
  await prisma.account.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: '5100' } }, update: {}, create: { organizationId: org.orgId, code: '5100', name: 'COGS', type: 'EXPENSE', normalSide: 'DEBIT' } });
  await prisma.account.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: '2130' } }, update: {}, create: { organizationId: org.orgId, code: '2130', name: 'PPN', type: 'LIABILITY', normalSide: 'CREDIT' } });
  await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in' } });
  const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: `SVC-${Date.now()}`, name: 'Haircut', type: 'SERVICE', sellingPrice: 50000, requiresBatchTracking: false }, select: { id: true } });
  const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'R1', warehouseId: org.warehouseId }, select: { id: true } });
  const shift = await prisma.posShift.create({ data: { organizationId: org.orgId, registerId: register.id, cashierId: 'cash', openingFloat: 0, status: 'OPEN' }, select: { id: true } });
  return { org, itemId: item.id, registerId: register.id, shiftId: shift.id };
}

function adminReq(orgId: string, url: string) {
  return new NextRequest(url, { headers: { 'x-org-id': orgId, 'x-user-id': 'admin', 'x-role-type': 'ADMIN' } });
}

describe('Sales Performance report', () => {
  it('rolls up per-employee sold vs target, with an Unassigned bucket', async () => {
    const o = await serviceOrg();
    const ani = await prisma.employee.create({ data: { organizationId: o.org.orgId, employeeNo: `A-${Date.now()}`, name: 'Ani', joinDate: new Date('2026-01-01') }, select: { id: true } });

    const line = (performedById?: string) => ({ itemId: o.itemId, description: 'Haircut', quantity: 1, price: 50000, discountPct: 0, performedById });
    // Two sales credited to Ani, one Unassigned (no performer, cashier has no staff record).
    await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, { clientSaleId: 's1', registerId: o.registerId, shiftId: o.shiftId, cashierId: 'cash', warehouseId: null, lines: [line(ani.id)], tenders: [{ method: 'CASH', amount: 50000 }], date: new Date('2026-07-05T05:00:00Z') }));
    await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, { clientSaleId: 's2', registerId: o.registerId, shiftId: o.shiftId, cashierId: 'cash', warehouseId: null, lines: [line(ani.id)], tenders: [{ method: 'CASH', amount: 50000 }], date: new Date('2026-07-06T05:00:00Z') }));
    await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, { clientSaleId: 's3', registerId: o.registerId, shiftId: o.shiftId, cashierId: 'cash', warehouseId: null, lines: [line(undefined)], tenders: [{ method: 'CASH', amount: 50000 }], date: new Date('2026-07-07T05:00:00Z') }));

    await prisma.posSalesTarget.create({ data: { organizationId: o.org.orgId, employeeId: ani.id, month: '2026-07', targetAmount: 500000 } });

    const res = await report(adminReq(o.org.orgId, 'http://localhost/api/v1/pos/reports/sales-performance?month=2026-07'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const aniRow = body.rows.find((r: any) => r.employeeId === ani.id);
    // Each Haircut line subtotal is the pre-tax 50000 (tax is embedded in the gross tender).
    expect(aniRow.sold).toBe(100000);
    expect(aniRow.target).toBe(500000);
    const unassigned = body.rows.find((r: any) => r.employeeId === null);
    expect(unassigned.sold).toBe(50000);
    expect(body.totals.sold).toBe(150000);

    await cleanupOrg(o.org.orgId);
  });

  it('is org-scoped and rejects callers without POS_REPORTS', async () => {
    const o = await serviceOrg();
    const role = await prisma.role.create({ data: { organizationId: o.org.orgId, name: 'NR', roleType: 'CUSTOM', permissions: { create: [{ moduleKey: 'DASHBOARD', canView: true }] } }, select: { id: true, roleType: true } });
    const user = await prisma.user.create({ data: { email: `nr2-${Date.now()}@x.com`, fullName: 'NR', passwordHash: 'x' }, select: { id: true } });
    await prisma.userOrganization.create({ data: { userId: user.id, organizationId: o.org.orgId, roleId: role.id, isActive: true } });
    const denied = await report(new NextRequest('http://localhost/api/v1/pos/reports/sales-performance?month=2026-07', { headers: { 'x-org-id': o.org.orgId, 'x-user-id': user.id, 'x-role-type': role.roleType } }));
    expect(denied.status).toBe(403);
    await cleanupOrg(o.org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:int -- pos-sales-performance`
Expected: FAIL — cannot resolve the report route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/pos/reports/sales-performance/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { wibMonthRange, computeSalesPerformance, UNASSIGNED } from '@/lib/pos/sales-performance';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const GET = withPermission({ module: 'POS_REPORTS', action: 'view' }, async (req: NextRequest) => {
  const orgId = requireOrg(req);
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return err('month=YYYY-MM is required', 400);

  const { start, end, daysInMonth, daysElapsed } = wibMonthRange(month, new Date());

  // Sum each invoice line's pre-tax subtotal, keyed by the credited staff member,
  // over POS sales whose soldAt falls in the WIB month.
  const sales = await prisma.posSale.findMany({
    where: { organizationId: orgId, soldAt: { gte: start, lt: end } },
    select: { salesInvoice: { select: { lines: { select: { performedById: true, lineSubtotal: true } } } } },
  });
  const soldByEmployee: Record<string, number> = {};
  for (const s of sales) {
    for (const line of s.salesInvoice.lines) {
      const key = line.performedById ?? UNASSIGNED;
      soldByEmployee[key] = (soldByEmployee[key] ?? 0) + Number(line.lineSubtotal);
    }
  }

  const targetRows = await prisma.posSalesTarget.findMany({
    where: { organizationId: orgId, month },
    select: { employeeId: true, targetAmount: true },
  });
  const targets: Record<string, number> = {};
  for (const t of targetRows) targets[t.employeeId] = Number(t.targetAmount);

  const ids = new Set<string>([
    ...Object.keys(soldByEmployee).filter((k) => k !== UNASSIGNED),
    ...Object.keys(targets),
  ]);
  const employees = ids.size
    ? await prisma.employee.findMany({ where: { organizationId: orgId, id: { in: [...ids] } }, select: { id: true, name: true } })
    : [];
  const names: Record<string, string> = {};
  for (const e of employees) names[e.id] = e.name;

  const { rows, totals } = computeSalesPerformance({ soldByEmployee, targets, names, daysInMonth, daysElapsed });
  return ok({ month, rows, totals });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:int -- pos-sales-performance`
Expected: PASS (rollup + Unassigned + 403).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/pos/reports/sales-performance/route.ts lib/__tests__/integration/pos-sales-performance.int.test.ts
git commit -m "feat(pos): Sales Performance report API (per-staff rollup vs target)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Register the `pos_reports` permission in the access store

**Files:**
- Modify: `src/stores/useAccessStore.ts`

- [ ] **Step 1: Add the module key**

In `MODULE_KEYS` (after the `reports:` line), add:

```ts
    pos_reports:   { label: 'Sales Performance',     group: 'Reports' },
```

- [ ] **Step 2: Include it in the Reports sidebar group**

In `SIDEBAR_PERMISSION_MAP`, change the `'Reports'` entry to:

```ts
    'Reports':             ['reports', 'pos_reports'],
```

- [ ] **Step 3: Map the sub-item path**

In `SUBITEM_PERMISSION_MAP` (after the `'/reports'` line), add:

```ts
    '/reports/sales-performance': 'pos_reports',
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (role editor will now list "Sales Performance" under Reports).

- [ ] **Step 5: Commit**

```bash
git add src/stores/useAccessStore.ts
git commit -m "feat(pos): register pos_reports permission in the access store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Front-end data hooks

**Files:**
- Create: `src/hooks/usePosReports.ts`

- [ ] **Step 1: Implement the hooks**

Create `src/hooks/usePosReports.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export type PerfStatus = 'green' | 'amber' | 'red' | null;

export interface PerfRow {
  employeeId: string | null;
  name: string;
  target: number;
  hasTarget: boolean;
  sold: number;
  remaining: number;
  pct: number | null;
  status: PerfStatus;
}

export interface SalesPerformanceResponse {
  month: string;
  rows: PerfRow[];
  totals: { target: number; sold: number };
}

export interface TargetRow {
  employeeId: string;
  name: string;
  targetAmount: number | null;
}

export interface TargetsResponse {
  month: string;
  targets: TargetRow[];
}

export function useSalesPerformance(month: string) {
  return useQuery({
    queryKey: ['pos-sales-performance', month],
    queryFn: () => api.get<SalesPerformanceResponse>('/api/v1/pos/reports/sales-performance', { month }),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

export function usePosTargets(month: string) {
  return useQuery({
    queryKey: ['pos-targets', month],
    queryFn: () => api.get<TargetsResponse>('/api/v1/pos/targets', { month }),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

export function useSavePosTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { month: string; targets: { employeeId: string; targetAmount: number | null }[] }) =>
      api.put<{ ok: boolean }>('/api/v1/pos/targets', payload),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['pos-targets', vars.month] });
      qc.invalidateQueries({ queryKey: ['pos-sales-performance', vars.month] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePosReports.ts
git commit -m "feat(pos): react-query hooks for sales performance + targets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Sales Performance page + route + nav

**Files:**
- Create: `src/views/reports/SalesPerformance.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Layout/Sidebar.tsx`

- [ ] **Step 1: Implement the page**

Create `src/views/reports/SalesPerformance.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import { formatIDR } from '../../utils/formatters';
import { useSalesPerformance, usePosTargets, useSavePosTargets } from '../../hooks/usePosReports';

function currentWibMonth(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}

const STATUS_COLOR: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

const SalesPerformance = () => {
  const [month, setMonth] = useState<string>(currentWibMonth());
  const [editing, setEditing] = useState(false);
  const { data, isLoading } = useSalesPerformance(month);
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { target: 0, sold: 0 };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Sales Performance</h1>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <button onClick={() => setEditing(true)} className="text-sm px-3 py-1 rounded bg-teal-600 text-white">
            Edit targets
          </button>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No sales or targets for this month yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 px-3">Staff</th>
                <th className="py-2 px-3 text-right">Target</th>
                <th className="py-2 px-3 text-right">Sold</th>
                <th className="py-2 px-3 text-right">Remaining</th>
                <th className="py-2 px-3 text-right">%</th>
                <th className="py-2 px-3 w-40">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId ?? 'unassigned'} className="border-b last:border-0">
                  <td className="py-2 px-3">
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${r.status ? STATUS_COLOR[r.status] : 'bg-gray-300'}`} />
                    {r.name}
                  </td>
                  <td className="py-2 px-3 text-right">{r.hasTarget ? formatIDR(r.target) : '—'}</td>
                  <td className="py-2 px-3 text-right">{formatIDR(r.sold)}</td>
                  <td className="py-2 px-3 text-right">{r.hasTarget ? formatIDR(r.remaining) : '—'}</td>
                  <td className="py-2 px-3 text-right">{r.pct == null ? '—' : `${r.pct}%`}</td>
                  <td className="py-2 px-3">
                    <div className="h-2 bg-gray-200 rounded">
                      <div
                        className={`h-2 rounded ${r.status ? STATUS_COLOR[r.status] : 'bg-gray-400'}`}
                        style={{ width: `${Math.min(100, r.pct ?? 0)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 px-3">Team total</td>
                <td className="py-2 px-3 text-right">{formatIDR(totals.target)}</td>
                <td className="py-2 px-3 text-right">{formatIDR(totals.sold)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {editing && <TargetEditor month={month} onClose={() => setEditing(false)} />}
    </div>
  );
};

function TargetEditor({ month, onClose }: { month: string; onClose: () => void }) {
  const { data } = usePosTargets(month);
  const save = useSavePosTargets();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of data?.targets ?? []) m[t.employeeId] = t.targetAmount == null ? '' : String(t.targetAmount);
    return m;
  }, [data]);

  const value = (id: string) => (id in draft ? draft[id] : (initial[id] ?? ''));

  const onSave = async () => {
    const targets = (data?.targets ?? []).map((t) => {
      const raw = value(t.employeeId).trim();
      const num = raw === '' ? null : Number(raw);
      return { employeeId: t.employeeId, targetAmount: Number.isFinite(num as number) ? (num as number) : null };
    });
    await save.mutateAsync({ month, targets });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-[28rem] max-h-[80vh] overflow-auto p-5 space-y-3">
        <h2 className="font-semibold">Targets — {month}</h2>
        <div className="space-y-2">
          {(data?.targets ?? []).map((t) => (
            <div key={t.employeeId} className="flex items-center justify-between gap-3">
              <span className="text-sm">{t.name}</span>
              <input
                type="number"
                min={0}
                value={value(t.employeeId)}
                onChange={(e) => setDraft((d) => ({ ...d, [t.employeeId]: e.target.value }))}
                className="border rounded px-2 py-1 text-sm w-40 text-right"
                placeholder="No target"
              />
            </div>
          ))}
          {(data?.targets ?? []).length === 0 && (
            <div className="text-sm text-gray-500">No active staff found. Add staff under HR &amp; Payroll first.</div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1 rounded border">Cancel</button>
          <button onClick={onSave} disabled={save.isPending} className="text-sm px-3 py-1 rounded bg-teal-600 text-white">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SalesPerformance;
```

- [ ] **Step 2: Add the guarded route**

In `src/App.tsx`, add a lazy import alongside the other reports imports (near line 71):

```ts
const SalesPerformance = lazy(() => import('./views/reports/SalesPerformance'))
```

And add a route in the same block as the other `reports`/`gl` routes:

```tsx
                    <Route path="reports/sales-performance" element={withPermission(<SalesPerformance />, 'pos_reports')} />
```

- [ ] **Step 3: Add the sidebar item**

In `src/components/Layout/Sidebar.tsx`, in the `Reports` group `items` array (around line 116), add after the existing Reports entry:

```tsx
            { label: 'Sales Performance', path: '/reports/sales-performance', icon: BarChart3 },
```

- [ ] **Step 4: Typecheck + build both entries**

Run: `npm run typecheck && npm run build`
Expected: no type errors; build succeeds (emits both `index.html` and `pos.html` bundles).

- [ ] **Step 5: Commit**

```bash
git add src/views/reports/SalesPerformance.tsx src/App.tsx src/components/Layout/Sidebar.tsx
git commit -m "feat(pos): Sales Performance page, route, and nav item

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Full suite + manual smoke checklist

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit + integration suite and typecheck**

Run: `npm test && npm run test:int && npm run typecheck`
Expected: all green — including the new `sales-performance`, `pos-sales-attribution`, `pos-sales-targets`, `pos-sales-performance` suites, with existing POS/accounting tests unaffected.

- [ ] **Step 2: Manual smoke (documented for the reviewer; requires dev servers + dev DB)**

To exercise it live: sync dev DB (`npx prisma db push`), grant a role `POS_REPORTS` (view + edit) or use ADMIN, ensure at least one active `Employee` exists (link a cashier via `Employee.userId` to auto-credit pharmacy sales), then `npm run dev` + `npm run backend:dev`. In the back office: **Reports → Sales Performance** → pick the month → **Edit targets** → save → ring up a POS sale → confirm the seller's "Sold" increases and the progress bar/% update.

- [ ] **Step 3: No commit** (verification task).

---

## Self-Review

**Spec coverage:**
- Monthly target per staff — `PosSalesTarget` (Task 1) + targets API (Task 5) + editor (Task 9). ✓
- Sales Performance scoreboard (target/sold/remaining/%/status + team total) — report API (Task 6) + page (Task 9). ✓
- Line-level → Employee attribution; pharmacy auto-credits cashier; Unassigned fallback — Tasks 1, 3, 4. ✓
- Pre-tax line value as the metric — report sums `lineSubtotal` (Task 6); asserted in its test. ✓
- WIB month boundaries incl. cross-midnight — `wibMonthRange` (Task 2) with explicit tests. ✓
- Pace-based status — `saleTargetStatus` (Task 2). ✓
- Manager-only `POS_REPORTS`, org isolation — `withPermission` on both routes; 403 + cross-org tests (Tasks 5, 6); access-store wiring (Task 7). ✓
- Salon front-end deferred — not in this plan (spec Non-Goals); `performedById` plumbing (Tasks 3, 4) is the foundation it builds on. ✓

**Placeholder scan:** every code step contains full code; commands include expected output. No TBD/TODO. ✓

**Type consistency:** `PerfRow`/`PerfStatus`/`SalesPerformanceResponse` shapes match between `lib/pos/sales-performance.ts` (Task 2), the report route (Task 6), and the front-end hooks/page (Tasks 8–9). `putPosTargetsSchema` (Task 5) matches the `useSavePosTargets` payload (Task 8). The compound unique `organizationId_employeeId_month` used by the upsert (Task 5) matches the `@@unique` in Task 1. ✓
