# Phase 3 — Invoice Void Reversal — Implementation Plan

> **For agentic workers:** TDD task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Voiding a posted sales invoice reverses *both* its journal entries (AR recognition + COGS) and puts the sold stock back, blocking when the invoice has receipts applied — instead of silently flipping the status and leaving the GL + inventory wrong.

**Architecture:** Dedicated `POST /invoices/[id]/void` → `lib/invoice-void.ts`. Mirrors `lib/bill-void.ts` (reverse JE + unwind inventory), but: invoices have no `journalEntryId` column, so posting entries are resolved by **deterministic memo** (`Sales recognition: <number>`, `COGS auto-post: <number>` — the latter one per inventory line); inventory is un-consumed via Phase 2's `restoreConsumedLayers(SALES, invoiceId)`. Block the silent `PUT status:VOID` path. Void button in the invoice detail view.

**Depends on:** Phase 2 (`restoreConsumedLayers`) — this branch stacks on `claude/void-integrity-phase2-foundation`.

**No migration.** `SalesInvoice.status` enum already has `VOID`; `paymentAllocations` already exists. No `journalEntryId`/`voidedAt` columns (mark status only; resolve JEs by memo).

## Facts (verified)
- Invoice posts on DRAFT→SENT: AR JE memo `Sales recognition: <number>` (DR AR / CR Sales / [DR discount] / [CR tax] / [rounding]); per inventory line a COGS JE memo `COGS auto-post: <number>` (DR COGS / CR Inventory), consuming stock via `calculateAndPostCOGS(..., InventoryDocumentType.SALES, invoiceId, ...)`. `postJournalEntry` writes `status: POSTED, source: SYSTEM`.
- `ARPaymentAllocation { invoiceId }` links receipts to invoices (`onDelete: Restrict`).
- `reverseJournalEntry(tx, jeId, {date, memo})` posts the storno; `restoreConsumedLayers(tx, orgId, SALES, invoiceId, date)` re-adds the stock.

---

### Task P3-1: `lib/invoice-void.ts`

**Files:** Create `lib/invoice-void.ts`; Test `lib/__tests__/invoice-void.test.ts`.

- [ ] **Step 1 — failing test** (`lib/__tests__/invoice-void.test.ts`):

```ts
/**
 * voidInvoice reverses the invoice's AR + COGS journal entries (resolved by
 * memo), un-consumes the sold stock, and marks the invoice VOID. Refuses
 * unposted, already-void, paid, or receipt-allocated invoices.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-REV' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../inventory-costing', () => ({ restoreConsumedLayers: vi.fn(async () => 400) }));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { restoreConsumedLayers } from '../inventory-costing';
import { voidInvoice } from '../invoice-void';

const DATE = new Date('2026-06-20');

function makeTx(invoice: any, entries: any[] = []) {
  return {
    salesInvoice: { findFirst: vi.fn(async () => invoice), update: vi.fn(async () => ({})) },
    journalEntry: { findMany: vi.fn(async () => entries) },
  };
}
const sent = (over: any = {}) => ({ id: 'inv-1', number: 'INV-0001', status: 'SENT', organizationId: 'org-a', paymentAllocations: [], ...over });

describe('voidInvoice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses every posting entry, un-consumes stock, and marks VOID', async () => {
    const tx = makeTx(sent(), [{ id: 'je-ar' }, { id: 'je-cogs' }]);
    await voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(tx.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'POSTED', memo: { in: ['Sales recognition: INV-0001', 'COGS auto-post: INV-0001'] } }) }),
    );
    expect(reverseJournalEntry).toHaveBeenCalledTimes(2);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-ar', expect.objectContaining({ date: DATE }));
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-cogs', expect.objectContaining({ date: DATE }));
    expect(restoreConsumedLayers).toHaveBeenCalledWith(tx, 'org-a', 'SALES', 'inv-1', DATE);
    expect((tx.salesInvoice.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('throws 404 when the invoice does not exist', async () => {
    const tx = makeTx(null);
    await expect(voidInvoice(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an already-voided invoice', async () => {
    const tx = makeTx(sent({ status: 'VOID' }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/already void/i);
  });

  it('refuses a draft invoice — delete it instead', async () => {
    const tx = makeTx(sent({ status: 'DRAFT' }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(restoreConsumedLayers).not.toHaveBeenCalled();
  });

  it('refuses a paid invoice', async () => {
    const tx = makeTx(sent({ status: 'PAID' }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/paid/i);
  });

  it('refuses an invoice with receipts applied', async () => {
    const tx = makeTx(sent({ paymentAllocations: [{ id: 'alloc-1' }] }));
    await expect(voidInvoice(tx as never, 'org-a', 'inv-1', { date: DATE })).rejects.toThrow(/receipt|payment|applied|unallocate/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (`npx vitest run lib/__tests__/invoice-void.test.ts`): cannot find `../invoice-void`.

- [ ] **Step 3 — implement** `lib/invoice-void.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { restoreConsumedLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

const VOIDABLE_STATUSES = new Set(['SENT', 'OVERDUE']);

/**
 * Void a posted sales invoice: reverse its AR-recognition and COGS journal
 * entries, put the sold stock back, and mark it VOID.
 *
 * Invoices have no journalEntryId column, so the posting entries are resolved by
 * their deterministic memos — `Sales recognition: <number>` (one) and
 * `COGS auto-post: <number>` (one per inventory line). The reversal is dated at
 * the void date and period-guarded. VOID is terminal.
 *
 * Refuses draft/pending (not posted — delete instead), already-void, paid, and
 * receipt-allocated invoices (unallocate the receipts first).
 */
export async function voidInvoice(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  opts: { date: Date },
): Promise<void> {
  const inv = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      id: true,
      number: true,
      status: true,
      paymentAllocations: { select: { id: true } },
    },
  });

  if (!inv) {
    throw new ApiError('Invoice not found', 404);
  }
  if (inv.status === 'VOID') {
    throw new ApiError('Invoice is already voided', 422);
  }
  if (inv.status === 'DRAFT' || inv.status === 'PENDING_APPROVAL') {
    throw new ApiError('Draft invoices are not posted — delete the invoice instead of voiding', 422);
  }
  if (inv.status === 'PAID') {
    throw new ApiError('Cannot void a paid invoice — void its receipts first', 422);
  }
  if (inv.paymentAllocations.length > 0) {
    throw new ApiError('Cannot void an invoice with receipts applied — unallocate them first', 422);
  }
  if (!VOIDABLE_STATUSES.has(inv.status)) {
    throw new ApiError(`Cannot void an invoice in status ${inv.status}`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);

  // Reverse the AR-recognition + COGS posting entries (resolved by memo — no
  // journalEntryId column on invoices).
  const entries = await tx.journalEntry.findMany({
    where: {
      organizationId: orgId,
      status: 'POSTED',
      memo: { in: [`Sales recognition: ${inv.number}`, `COGS auto-post: ${inv.number}`] },
    },
    select: { id: true },
  });
  for (const entry of entries) {
    await reverseJournalEntry(tx, entry.id, { date: opts.date, memo: `Void invoice: ${inv.number}` });
  }

  // Put the sold stock back (un-consume the SALES draw-down).
  await restoreConsumedLayers(tx, orgId, InventoryDocumentType.SALES, inv.id, opts.date);

  await tx.salesInvoice.update({ where: { id: inv.id, organizationId: orgId }, data: { status: 'VOID' } });
}
```

- [ ] **Step 4 — run, expect PASS** (6 tests).
- [ ] **Step 5 — commit:** `feat(ar): void invoice reverses AR+COGS JE and un-consumes stock`

---

### Task P3-2: void route + block silent PUT

**Files:** Create `src/app/api/v1/invoices/[id]/void/route.ts`; Modify `src/app/api/v1/invoices/[id]/route.ts` (PUT guard); Test `src/app/api/v1/__tests__/invoice-void-route.test.ts`.

- [ ] **Step 1 — failing test** (`src/app/api/v1/__tests__/invoice-void-route.test.ts`): mirror `note-void-route.test.ts` — mock `@/lib/prisma`, `@/lib/cors`, `@/lib/invoice-void` (`voidInvoice`). Assert: POST `/void` runs in `$transaction`, calls `voidInvoice(tx,'org-a','inv-1',{date})`, returns 200; an `ApiError(422)` maps to 422; `PUT { status:'VOID' }` returns 422 and never calls `$transaction`.

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => undefined) } } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/invoice-void', () => ({ voidInvoice: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidInvoice } from '@/lib/invoice-void';
import { ApiError } from '@/lib/errors';
import { POST as voidRoute } from '../invoices/[id]/void/route';
import { PUT as putInvoice } from '../invoices/[id]/route';

const params = { params: Promise.resolve({ id: 'inv-1' }) };
function post() { return new NextRequest('http://localhost/api/v1/invoices/inv-1/void', { method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1' } }); }
function putVoid() { return new NextRequest('http://localhost/api/v1/invoices/inv-1', { method: 'PUT', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'VOID' }) }); }

beforeEach(() => vi.clearAllMocks());

it('void route reverses and returns the invoice', async () => {
  const tx = { salesInvoice: { findFirst: vi.fn(async () => ({ id: 'inv-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(200);
  expect(voidInvoice).toHaveBeenCalledWith(tx, 'org-a', 'inv-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ salesInvoice: { findFirst: vi.fn() } }));
  vi.mocked(voidInvoice).mockRejectedValueOnce(new ApiError('Cannot void a paid invoice', 422));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(422);
});

it('PUT status:VOID is rejected (422) and does not run the transaction', async () => {
  const res = await putInvoice(putVoid(), params);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement route** `src/app/api/v1/invoices/[id]/void/route.ts` (copy bill-void route shape):

```ts
// POST /api/v1/invoices/[id]/void
// Reverses a posted invoice's AR + COGS journals, restores sold stock, marks VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidInvoice } from '@/lib/invoice-void';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const invoice = await prisma.$transaction(async (tx) => {
    await voidInvoice(tx, orgId, id, { date });
    return tx.salesInvoice.findFirst({
      where: { id, organizationId: orgId },
      include: { customer: { select: { id: true, name: true, code: true } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'VOID', payload: null });
  return ok(invoice);
});
```

- [ ] **Step 3b — block PUT VOID:** in `src/app/api/v1/invoices/[id]/route.ts` PUT, right after the request body is parsed (the line that produces `header`/`body` with `status`), add (using the file's existing response helper — it uses `withCors(NextResponse.json(...))`):

```ts
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted invoice through POST /api/v1/invoices/:id/void' },
        { status: 422 },
      ));
    }
```

(Place it before the `prisma.$transaction(...)` call. If the handler names the parsed object `body` not `header`, use `body.status`.)

- [ ] **Step 4 — run, expect PASS** (3 tests).
- [ ] **Step 5 — commit:** `feat(ar): POST /invoices/[id]/void; reject silent PUT status:VOID`

---

### Task P3-3: integration round-trip (real Postgres)

**Files:** Create `lib/__tests__/integration/invoice-void-invariants.int.test.ts`.

Build an org + customer + item; receive stock (`addCostLayer` PURCHASE); create a DRAFT invoice with one stocked line; drive it to SENT through the **real posting code** the route uses (post the AR JE via `postJournalEntry` with memo `Sales recognition: <number>`, and the COGS via `calculateAndPostCOGS` + a `COGS auto-post: <number>` JE) — or, simpler and higher-fidelity, call the invoice route's posting helper if extractable; otherwise replicate the two posts inline matching the memos. Then snapshot trial balance, `voidInvoice`, and assert:
- trial balance balances and AR control + COGS + inventory GL return to pre-send,
- inventory lots/ledger reconciled and on-hand value back to the received amount (`assertInventoryReconciled`),
- `status === 'VOID'`,
- journal entry count == posts + reversals.

- [ ] Implement, run with the test DB (`TEST_DATABASE_URL=<...msm_accounting_test>`), commit: `test(ar): integration invoice void round-trip (GL + inventory)`

---

### Task P3-4: frontend Void action

**Files:** Modify `src/hooks/useAR.ts` (add `useVoidInvoice`); Modify `src/views/ar/InvoiceWorkbench.tsx` + `src/views/ar/InvoiceDetailTabs.tsx` (Void button).

- [ ] **Step 1 — hook** in `src/hooks/useAR.ts` (after `useDeleteInvoice`):

```ts
export function useVoidInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post(`/api/v1/invoices/${id}/void`, {}),
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: AR_KEYS.invoices });
            qc.invalidateQueries({ queryKey: AR_KEYS.invoice(id) });
        },
    });
}
```

- [ ] **Step 2 — wire the Void action** through `InvoiceWorkbench` → `InvoiceDetailTabs`: read `InvoiceDetailTabs.tsx` to find its action-button area (it already receives `onEdit`, `onPrint`, `canEdit`, `canDelete`). Add an `onVoid?: () => void` + `canVoid?: boolean` prop, render a **Void** button shown when the invoice status is `Sent` or `Overdue` and `canVoid`, behind a `window.confirm('Void this invoice? Its journal entries will be reversed and the sold stock returned to inventory. This cannot be undone.')`. In `InvoiceWorkbench`, instantiate `const voidInvoice = useVoidInvoice();`, pass `canVoid={canEdit}` and `onVoid={() => { if (!window.confirm(...)) return; voidInvoice.mutate(selectedInvoice.id, { onError: e => window.alert(e instanceof Error ? e.message : 'Failed to void invoice') }); }}`.

- [ ] **Step 3 — `npm run typecheck`** clean; commit: `feat(ar): Void action in the invoice detail view`

---

### Task P3-5: verify + review + PR

- [ ] `npm test` (unit), `npx tsc --noEmit`, `npm run test:int` (with test DB) — all green.
- [ ] Independent code review of the Phase 3 diff; address must-fix items.
- [ ] Push `claude/void-integrity-phase3-invoices`; open PR with **base = `claude/void-integrity-phase2-foundation`** (stacked on Phase 2 until #51 merges).

## Self-review
- Spec coverage: lib (P3-1), route + PUT guard (P3-2), integration (P3-3), UI (P3-4), verify/review/PR (P3-5). ✓
- Dual-JE reversal by memo (AR + per-line COGS), inventory un-consume via Phase 2, paid/allocation/period guards, no migration. ✓
- Mirrors bill-void (reverse JE + unwind inventory, no new balancing post — the COGS-JE reversal restores inventory GL, `restoreConsumedLayers` restores the subledger; amounts match). ✓
