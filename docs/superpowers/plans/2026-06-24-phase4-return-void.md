# Phase 4 — Sales/Purchase Return Void Reversal — Implementation Plan

> TDD task-by-task. Checkbox (`- [ ]`) steps.

**Goal:** Voiding a posted sales/purchase return reverses its inventory journal entry and unwinds the stock it moved — a sales return *removes the restock it added* (blocking if re-sold); a purchase return *puts back the stock it removed* — instead of silently flipping status and leaving GL + inventory wrong.

**Architecture:** `POST /<sales|purchase>-returns/[id]/void` → shared `lib/return-void.ts` (config-driven, like `payment-void.ts`). Returns HAVE a `journalEntryId` column, so the inventory JE is resolved directly (no memo). Sales-return unwind = Phase 2 `reverseAddedLayers(SALES_RETURN, id)`; purchase-return unwind = Phase 2 `restoreConsumedLayers(PURCHASE_RETURN, id)`. Block the silent `PUT status:VOID`. Void buttons for APPROVED returns in the existing CreditNotes/DebitNotes views.

**Depends on:** Phase 2 — stacks on `claude/void-integrity-phase2-foundation`.

## Facts (verified)
- `SalesReturn`/`PurchaseReturn`: `status ReturnStatus` (DRAFT, APPROVED, PENDING_CREDIT_NOTE, PENDING_DEBIT_NOTE, APPLIED, VOID), nullable `journalEntryId`, relations `creditNotes`/`debitNotes`, `warehouseId`.
- Sales-return APPROVED posts `addCostLayer(SALES_RETURN, srId)` restock + JE DR Inventory / CR COGS, stamps `journalEntryId`. Services-only return (zero restock value) sets `postedAt` but NO JE / journalEntryId.
- Purchase-return APPROVED consumes `calculateAndPostCOGS(PURCHASE_RETURN, prId)` + JE DR apReturn / CR Inventory.
- Accounting: purchase-return shares the `apReturn` clearing account with its debit note → voiding while a note is APPLIED would unbalance it. Block voiding a return that has an APPLIED linked note (apply to sales returns too, for symmetry/safety).
- Both `[id]` routes: `const { lines, ...header } = body` then `prisma.$transaction(...)`. Guard goes before the transaction.

---

### Task P4-1: `lib/return-void.ts`

**Files:** Create `lib/return-void.ts`; Test `lib/__tests__/return-void.test.ts`.

- [ ] **Step 1 — failing test** (`lib/__tests__/return-void.test.ts`):

```ts
/**
 * voidSalesReturn / voidPurchaseReturn reverse a posted return's inventory JE
 * and unwind the stock it moved (sales return removes its restock; purchase
 * return restores its draw-down), then mark VOID. Refuse draft, already-void,
 * and returns with an APPLIED linked note.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-REV' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));
vi.mock('../inventory-costing', () => ({
  reverseAddedLayers: vi.fn(async () => 500),
  restoreConsumedLayers: vi.fn(async () => 500),
}));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { reverseAddedLayers, restoreConsumedLayers } from '../inventory-costing';
import { voidSalesReturn, voidPurchaseReturn } from '../return-void';

const DATE = new Date('2026-06-20');

function makeSrTx(ret: any) {
  return { salesReturn: { findFirst: vi.fn(async () => ret), update: vi.fn(async () => ({})) } };
}
function makePrTx(ret: any) {
  return { purchaseReturn: { findFirst: vi.fn(async () => ret), update: vi.fn(async () => ({})) } };
}
const sr = (over: any = {}) => ({ id: 'sr-1', number: 'SR-0001', status: 'APPROVED', journalEntryId: 'je-1', creditNotes: [], ...over });
const pr = (over: any = {}) => ({ id: 'pr-1', number: 'PR-0001', status: 'APPROVED', journalEntryId: 'je-2', debitNotes: [], ...over });

describe('voidSalesReturn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE, removes the restock, and marks VOID', async () => {
    const tx = makeSrTx(sr());
    await voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE });
    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect(reverseAddedLayers).toHaveBeenCalledWith(tx, 'org-a', 'SALES_RETURN', 'sr-1', DATE);
    expect((tx.salesReturn.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('throws 404 when missing', async () => {
    const tx = makeSrTx(null);
    await expect(voidSalesReturn(tx as never, 'org-a', 'x', { date: DATE })).rejects.toThrow(/not found/i);
  });

  it('refuses an already-voided return', async () => {
    const tx = makeSrTx(sr({ status: 'VOID' }));
    await expect(voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE })).rejects.toThrow(/already void/i);
  });

  it('refuses a draft return — delete instead', async () => {
    const tx = makeSrTx(sr({ status: 'DRAFT', journalEntryId: null }));
    await expect(voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(reverseAddedLayers).not.toHaveBeenCalled();
  });

  it('refuses a return with an applied credit note', async () => {
    const tx = makeSrTx(sr({ creditNotes: [{ id: 'cn-1' }] }));
    await expect(voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE })).rejects.toThrow(/credit note/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('skips JE reversal for a services-only return (no journalEntryId) but still unwinds + voids', async () => {
    const tx = makeSrTx(sr({ journalEntryId: null }));
    await voidSalesReturn(tx as never, 'org-a', 'sr-1', { date: DATE });
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(reverseAddedLayers).toHaveBeenCalled();
    expect((tx.salesReturn.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });
});

describe('voidPurchaseReturn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE, restores the removed stock, and marks VOID', async () => {
    const tx = makePrTx(pr());
    await voidPurchaseReturn(tx as never, 'org-a', 'pr-1', { date: DATE });
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-2', expect.objectContaining({ date: DATE }));
    expect(restoreConsumedLayers).toHaveBeenCalledWith(tx, 'org-a', 'PURCHASE_RETURN', 'pr-1', DATE);
    expect((tx.purchaseReturn.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('refuses a return with an applied debit note', async () => {
    const tx = makePrTx(pr({ debitNotes: [{ id: 'dn-1' }] }));
    await expect(voidPurchaseReturn(tx as never, 'org-a', 'pr-1', { date: DATE })).rejects.toThrow(/debit note/i);
  });
});
```

- [ ] **Step 2 — run, FAIL.**
- [ ] **Step 3 — implement** `lib/return-void.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { InventoryDocumentType } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';
import { reverseAddedLayers, restoreConsumedLayers } from './inventory-costing';

type Tx = Prisma.TransactionClient;

interface ReturnRow {
  id: string;
  number: string;
  status: string;
  journalEntryId: string | null;
  appliedNotes: { id: string }[];
}

interface VoidConfig {
  label: string;
  noteLabel: string;
  find: (tx: Tx, orgId: string, id: string) => Promise<ReturnRow | null>;
  unwindInventory: (tx: Tx, orgId: string, id: string, date: Date) => Promise<number>;
  markVoid: (tx: Tx, orgId: string, id: string) => Promise<unknown>;
}

/**
 * Shared void core for returns: reverse the inventory posting entry, unwind the
 * stock the return moved, and mark VOID. Period-guarded; VOID is terminal.
 *
 * The financial leg lives on the linked credit/debit note (voided separately).
 * Because a purchase return shares the apReturn clearing account with its debit
 * note, voiding a return that already has an APPLIED note would unbalance it —
 * so that is blocked (applied to both return types for symmetry).
 *
 * Draft returns are not posted (delete instead). A services-only return has no
 * journalEntryId — skip the JE reversal but still unwind (no-op) and mark VOID.
 */
async function voidReturn(
  tx: Tx,
  orgId: string,
  id: string,
  opts: { date: Date },
  cfg: VoidConfig,
): Promise<void> {
  const ret = await cfg.find(tx, orgId, id);
  if (!ret) {
    throw new ApiError(`${cfg.label} not found`, 404);
  }
  if (ret.status === 'VOID') {
    throw new ApiError(`${cfg.label} is already voided`, 422);
  }
  if (ret.status === 'DRAFT') {
    throw new ApiError(`Draft ${cfg.label}s are not posted — delete instead of voiding`, 422);
  }
  if (ret.appliedNotes.length > 0) {
    throw new ApiError(`Cannot void this ${cfg.label} — void the linked ${cfg.noteLabel} first`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);
  if (ret.journalEntryId) {
    await reverseJournalEntry(tx, ret.journalEntryId, { date: opts.date, memo: `Void ${cfg.label}: ${ret.number}` });
  }
  await cfg.unwindInventory(tx, orgId, id, opts.date);
  await cfg.markVoid(tx, orgId, id);
}

const SR_CONFIG: VoidConfig = {
  label: 'sales return',
  noteLabel: 'credit note',
  find: async (tx, orgId, id) => {
    const r = await tx.salesReturn.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, number: true, status: true, journalEntryId: true, creditNotes: { where: { status: 'APPLIED' }, select: { id: true } } },
    });
    return r ? { id: r.id, number: r.number, status: r.status, journalEntryId: r.journalEntryId, appliedNotes: r.creditNotes } : null;
  },
  unwindInventory: (tx, orgId, id, date) => reverseAddedLayers(tx, orgId, InventoryDocumentType.SALES_RETURN, id, date),
  markVoid: (tx, orgId, id) => tx.salesReturn.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

const PR_CONFIG: VoidConfig = {
  label: 'purchase return',
  noteLabel: 'debit note',
  find: async (tx, orgId, id) => {
    const r = await tx.purchaseReturn.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, number: true, status: true, journalEntryId: true, debitNotes: { where: { status: 'APPLIED' }, select: { id: true } } },
    });
    return r ? { id: r.id, number: r.number, status: r.status, journalEntryId: r.journalEntryId, appliedNotes: r.debitNotes } : null;
  },
  unwindInventory: (tx, orgId, id, date) => restoreConsumedLayers(tx, orgId, InventoryDocumentType.PURCHASE_RETURN, id, date),
  markVoid: (tx, orgId, id) => tx.purchaseReturn.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

export function voidSalesReturn(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidReturn(tx, orgId, id, opts, SR_CONFIG);
}

export function voidPurchaseReturn(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidReturn(tx, orgId, id, opts, PR_CONFIG);
}
```

- [ ] **Step 4 — run, PASS (8 tests). Step 5 — commit:** `feat(returns): void core reverses inventory JE + unwinds stock`

---

### Task P4-2: void routes + block silent PUT

**Files:** Create `src/app/api/v1/sales-returns/[id]/void/route.ts`, `src/app/api/v1/purchase-returns/[id]/void/route.ts`; Modify both `[id]/route.ts` PUTs; Test `src/app/api/v1/__tests__/return-void-route.test.ts`.

- [ ] Route shape (copy bill-void): `withHandler` + `requireOrg` + `$transaction(voidSalesReturn → re-fetch)` + `logAudit({ entityType: 'SalesReturn'|'PurchaseReturn', action: 'VOID' })` + `ok(ret)`. `date = new Date()`.
- [ ] PUT guard in both `[id]/route.ts`, after `const { lines, ...header } = body;` and before `prisma.$transaction`:

```ts
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted sales return through POST /api/v1/sales-returns/:id/void' },
        { status: 422 },
      ));
    }
```
(purchase-returns: "purchase return" + `/api/v1/purchase-returns/:id/void`.)

- [ ] Route test mirrors `note-void-route.test.ts`: mock prisma/cors/`@/lib/return-void`; assert each `/void` POST calls the right fn + 200, ApiError→status, and PUT `status:VOID` → 422 (no `$transaction`).
- [ ] Commit: `feat(returns): POST /[id]/void endpoints; reject silent PUT status:VOID`

---

### Task P4-3: integration round-trips (real Postgres)

**Files:** Create `lib/__tests__/integration/return-void-invariants.int.test.ts`.

- [ ] **Sales return:** receive stock; `addCostLayer(SALES_RETURN, sr.id)` restock + post DR Inventory / CR COGS JE, stamp `journalEntryId`; `voidSalesReturn`; assert trial balanced, inventory back down to pre-restock, reconciled, status VOID. Plus: a second SR whose restock is partly consumed (`relieveCostLayers`) → `voidSalesReturn` rejects `/consumed|sold/i`.
- [ ] **Purchase return:** receive stock; `calculateAndPostCOGS(PURCHASE_RETURN, pr.id)` removal + post DR apReturn / CR Inventory JE, stamp `journalEntryId`; `voidPurchaseReturn`; assert trial balanced, inventory restored, reconciled, status VOID, JE count == post + reversal.
- [ ] Run with the test DB; commit: `test(returns): integration void round-trips (GL + inventory)`

---

### Task P4-4: frontend Void actions

**Files:** Modify `src/hooks/useReturns.ts` (`useVoidSalesReturn`, `useVoidPurchaseReturn`); `src/views/ar/CreditNotes.tsx` (sales-return Void); `src/views/ap/DebitNotes.tsx` (purchase-return Void).

- [ ] Hooks: `mutationFn: (id) => api.post('/api/v1/sales-returns/${id}/void')`, invalidate `['salesReturns']` (and `['purchaseReturns']`).
- [ ] In CreditNotes.tsx: a **Void** action on `Approved` sales-return rows (`returnColumns`) and the `selectedReturn` detail header, behind a confirm dialog ("Void this sales return? Its journal entry will be reversed and the restocked inventory removed. This cannot be undone."), gated by `canEdit`. Mirror in DebitNotes.tsx for purchase returns ("…the returned stock will be added back…").
- [ ] `npm run typecheck`; commit: `feat(returns): Void actions for sales/purchase returns`

---

### Task P4-5: verify + review + PR
- [ ] `npm test`, `npx tsc --noEmit`, `npm run test:int` (test DB) — green.
- [ ] Independent review; address must-fix.
- [ ] Push; PR base = `claude/void-integrity-phase2-foundation`.

## Self-review
- Sales return removes its added restock (`reverseAddedLayers`, blocks if re-sold); purchase return restores its draw-down (`restoreConsumedLayers`). JE resolved by `journalEntryId` (returns have it). Applied-note guard protects the shared apReturn clearing account. Services-only return (no JE) handled. No migration. ✓
