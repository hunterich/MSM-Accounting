# Phase 1 — Credit & Debit Note Void Reversal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make voiding an *applied* credit/debit note reverse its posting journal entry, so the ledger and AR/AP subledger return to their pre-apply state — instead of silently flipping the status and leaving the entry live.

**Architecture:** Mirror the existing `lib/payment-void.ts` + dedicated `POST /[id]/void` route pattern exactly. A shared `lib/note-void.ts` core (find → guard → `assertPeriodOpen` → `reverseJournalEntry` → mark `VOID`) is exposed as `voidCreditNote` / `voidDebitNote`, each behind a thin `POST` route. The buggy silent path (`PUT { status: 'VOID' }`) is closed with a 422. Frontend gets `useVoidCreditNote`/`useVoidDebitNote` hooks and a "Void" action on applied notes.

**Tech Stack:** Next.js route handlers (`runtime = 'nodejs'`), Prisma (`$transaction`), Vitest (mocked unit + real-Postgres integration), React Query v5, React 19.

**Spec:** `docs/superpowers/specs/2026-06-24-note-void-reversal-design.md` (Phase 1 of `docs/superpowers/specs/2026-06-24-void-integrity-program-design.md`).

**No migration.** `CreditNote`/`DebitNote` already have `status` (enum includes `VOID`), `journalEntryId @unique`, `postedAt`.

---

## Setup (run once before starting)

This worktree shares a Prisma client across worktrees — regenerate before typechecking/testing.

- [ ] Run: `npm run prisma:generate`
- [ ] Run: `npm test` — confirm the suite is green *before* changes (baseline).

## File Structure

- Create `lib/note-void.ts` — `voidCreditNote` / `voidDebitNote` (shared core + per-note config). One responsibility: reverse a posted note's JE and mark it VOID.
- Create `lib/__tests__/note-void.test.ts` — mocked unit tests for the core + both exports.
- Create `src/app/api/v1/credit-notes/[id]/void/route.ts` — `POST` endpoint.
- Create `src/app/api/v1/debit-notes/[id]/void/route.ts` — `POST` endpoint.
- Create `src/app/api/v1/__tests__/note-void-route.test.ts` — route tests (both void routes + both PUT rejections).
- Modify `src/app/api/v1/credit-notes/[id]/route.ts` — reject `PUT { status: 'VOID' }` (422).
- Modify `src/app/api/v1/debit-notes/[id]/route.ts` — reject `PUT { status: 'VOID' }` (422).
- Create `lib/__tests__/integration/note-void-invariants.int.test.ts` — post→void round-trip, real Postgres.
- Modify `src/hooks/useReturns.ts` — add `useVoidCreditNote`/`useVoidDebitNote`; drop `Void` from the up-maps.
- Modify `src/views/ar/CreditNotes.tsx` — Void action on applied credit notes.
- Modify `src/views/ap/DebitNotes.tsx` — Void action on applied debit notes.

---

### Task 1: `lib/note-void.ts` core

**Files:**
- Create: `lib/note-void.ts`
- Test: `lib/__tests__/note-void.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/note-void.test.ts`:

```ts
/**
 * voidCreditNote / voidDebitNote reverse a posted note's journal entry and mark
 * it VOID. Unposted (no journalEntryId) and already-voided notes are refused.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../reverse-journal-entry', () => ({ reverseJournalEntry: vi.fn(async () => ({ id: 'je-rev', entryNo: 'JE-000099' })) }));
vi.mock('../period-guard', () => ({ assertPeriodOpen: vi.fn(async () => undefined) }));

import { reverseJournalEntry } from '../reverse-journal-entry';
import { assertPeriodOpen } from '../period-guard';
import { voidCreditNote, voidDebitNote } from '../note-void';

const DATE = new Date('2026-06-20');

function makeCnTx(note: any) {
  return { creditNote: { findFirst: vi.fn(async () => note), update: vi.fn(async () => ({})) } };
}
function makeDnTx(note: any) {
  return { debitNote: { findFirst: vi.fn(async () => note), update: vi.fn(async () => ({})) } };
}

const cnApplied = (over: any = {}) => ({ id: 'cn-1', number: 'CN-0001', status: 'APPLIED', journalEntryId: 'je-1', ...over });
const dnApplied = (over: any = {}) => ({ id: 'dn-1', number: 'DN-0001', status: 'APPLIED', journalEntryId: 'je-2', ...over });

describe('voidCreditNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE and marks VOID', async () => {
    const tx = makeCnTx(cnApplied());
    await voidCreditNote(tx as never, 'org-a', 'cn-1', { date: DATE });

    expect(assertPeriodOpen).toHaveBeenCalledWith(tx, 'org-a', DATE);
    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-1', expect.objectContaining({ date: DATE }));
    expect((tx.creditNote.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });

  it('throws 404 when the note does not exist', async () => {
    const tx = makeCnTx(null);
    await expect(voidCreditNote(tx as never, 'org-a', 'nope', { date: DATE })).rejects.toThrow(/not found/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an already-voided note', async () => {
    const tx = makeCnTx(cnApplied({ status: 'VOID' }));
    await expect(voidCreditNote(tx as never, 'org-a', 'cn-1', { date: DATE })).rejects.toThrow(/already void/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an unposted (draft) note — delete it instead', async () => {
    const tx = makeCnTx(cnApplied({ journalEntryId: null, status: 'DRAFT' }));
    await expect(voidCreditNote(tx as never, 'org-a', 'cn-1', { date: DATE })).rejects.toThrow(/not posted|delete/i);
    expect(reverseJournalEntry).not.toHaveBeenCalled();
    expect(tx.creditNote.update).not.toHaveBeenCalled();
  });
});

describe('voidDebitNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses the JE and marks VOID', async () => {
    const tx = makeDnTx(dnApplied());
    await voidDebitNote(tx as never, 'org-a', 'dn-1', { date: DATE });

    expect(reverseJournalEntry).toHaveBeenCalledWith(tx, 'je-2', expect.objectContaining({ date: DATE }));
    expect((tx.debitNote.update as any).mock.calls[0][0].data).toMatchObject({ status: 'VOID' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/note-void.test.ts`
Expected: FAIL — `Cannot find module '../note-void'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/note-void.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import { assertPeriodOpen } from './period-guard';
import { reverseJournalEntry } from './reverse-journal-entry';

type Tx = Prisma.TransactionClient;

interface NoteRow {
  id: string;
  number: string;
  status: string;
  journalEntryId: string | null;
}

interface VoidConfig {
  label: string;
  find: (tx: Tx, orgId: string, id: string) => Promise<NoteRow | null>;
  markVoid: (tx: Tx, orgId: string, id: string) => Promise<unknown>;
}

/**
 * Shared void core: reverse the note's posting entry (storno) and mark it VOID.
 * Period-guarded; VOID is terminal. The original posting JE and the note's
 * journalEntryId are left intact (append-only ledger + audit trail); the PUT
 * handler separately blocks any `* -> DRAFT` transition, so a voided note can
 * never be re-applied to post a second entry.
 *
 * Only posted notes (APPLIED, with a journalEntryId) can be voided — an
 * unposted draft has no GL impact and should simply be deleted.
 */
async function voidNote(
  tx: Tx,
  orgId: string,
  id: string,
  opts: { date: Date },
  cfg: VoidConfig,
): Promise<void> {
  const note = await cfg.find(tx, orgId, id);
  if (!note) {
    throw new ApiError(`${cfg.label} not found`, 404);
  }
  if (note.status === 'VOID') {
    throw new ApiError(`${cfg.label} is already voided`, 422);
  }
  if (!note.journalEntryId) {
    throw new ApiError(`${cfg.label} is not posted — delete the draft instead of voiding`, 422);
  }

  await assertPeriodOpen(tx, orgId, opts.date);
  await reverseJournalEntry(tx, note.journalEntryId, {
    date: opts.date,
    memo: `Void ${cfg.label}: ${note.number}`,
  });
  await cfg.markVoid(tx, orgId, id);
}

const CN_CONFIG: VoidConfig = {
  label: 'credit note',
  find: (tx, orgId, id) =>
    tx.creditNote.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  markVoid: (tx, orgId, id) => tx.creditNote.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

const DN_CONFIG: VoidConfig = {
  label: 'debit note',
  find: (tx, orgId, id) =>
    tx.debitNote.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, journalEntryId: true } }),
  markVoid: (tx, orgId, id) => tx.debitNote.update({ where: { id, organizationId: orgId }, data: { status: 'VOID' } }),
};

export function voidCreditNote(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidNote(tx, orgId, id, opts, CN_CONFIG);
}

export function voidDebitNote(tx: Tx, orgId: string, id: string, opts: { date: Date }): Promise<void> {
  return voidNote(tx, orgId, id, opts, DN_CONFIG);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/note-void.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/note-void.ts lib/__tests__/note-void.test.ts
git commit -m "feat(notes): void core reverses posted credit/debit note JE"
```

---

### Task 2: Credit & debit note void routes

**Files:**
- Create: `src/app/api/v1/credit-notes/[id]/void/route.ts`
- Create: `src/app/api/v1/debit-notes/[id]/void/route.ts`
- Test: `src/app/api/v1/__tests__/note-void-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/v1/__tests__/note-void-route.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: { create: vi.fn(async () => undefined) },
  },
}));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/note-void', () => ({ voidCreditNote: vi.fn(), voidDebitNote: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidCreditNote, voidDebitNote } from '@/lib/note-void';
import { ApiError } from '@/lib/errors';
import { POST as voidCredit } from '../credit-notes/[id]/void/route';
import { POST as voidDebit } from '../debit-notes/[id]/void/route';

function post(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1' } });
}
const cnParams = { params: Promise.resolve({ id: 'cn-1' }) };
const dnParams = { params: Promise.resolve({ id: 'dn-1' }) };

beforeEach(() => vi.clearAllMocks());

it('credit-note void route reverses and returns the note', async () => {
  const tx = { creditNote: { findFirst: vi.fn(async () => ({ id: 'cn-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await voidCredit(post('/api/v1/credit-notes/cn-1/void'), cnParams);
  expect(res.status).toBe(200);
  expect(voidCreditNote).toHaveBeenCalledWith(tx, 'org-a', 'cn-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('credit-note void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ creditNote: { findFirst: vi.fn() } }));
  vi.mocked(voidCreditNote).mockRejectedValueOnce(new ApiError('credit note is already voided', 422));
  const res = await voidCredit(post('/api/v1/credit-notes/cn-1/void'), cnParams);
  expect(res.status).toBe(422);
});

it('debit-note void route reverses and returns the note', async () => {
  const tx = { debitNote: { findFirst: vi.fn(async () => ({ id: 'dn-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await voidDebit(post('/api/v1/debit-notes/dn-1/void'), dnParams);
  expect(res.status).toBe(200);
  expect(voidDebitNote).toHaveBeenCalledWith(tx, 'org-a', 'dn-1', expect.objectContaining({ date: expect.any(Date) }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/v1/__tests__/note-void-route.test.ts`
Expected: FAIL — cannot find `../credit-notes/[id]/void/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/v1/credit-notes/[id]/void/route.ts`:

```ts
// POST /api/v1/credit-notes/[id]/void
// Reverses an applied credit note's journal entry and marks it VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidCreditNote } from '@/lib/note-void';

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

  const note = await prisma.$transaction(async (tx) => {
    await voidCreditNote(tx, orgId, id, { date });
    return tx.creditNote.findFirst({
      where: { id, organizationId: orgId },
      include: { customer: { select: { id: true, name: true, code: true } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'CreditNote', entityId: id, action: 'VOID', payload: null });
  return ok(note);
});
```

Create `src/app/api/v1/debit-notes/[id]/void/route.ts`:

```ts
// POST /api/v1/debit-notes/[id]/void
// Reverses an applied debit note's journal entry and marks it VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidDebitNote } from '@/lib/note-void';

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

  const note = await prisma.$transaction(async (tx) => {
    await voidDebitNote(tx, orgId, id, { date });
    return tx.debitNote.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: { select: { id: true, name: true, code: true } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: id, action: 'VOID', payload: null });
  return ok(note);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/v1/__tests__/note-void-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/credit-notes/\[id\]/void/route.ts src/app/api/v1/debit-notes/\[id\]/void/route.ts src/app/api/v1/__tests__/note-void-route.test.ts
git commit -m "feat(notes): POST /[id]/void endpoints for credit/debit notes"
```

---

### Task 3: Close the silent `PUT { status: 'VOID' }` path

**Files:**
- Modify: `src/app/api/v1/credit-notes/[id]/route.ts` (PUT handler, after `const body = await req.json();` near line 56)
- Modify: `src/app/api/v1/debit-notes/[id]/route.ts` (PUT handler, same spot)
- Test: `src/app/api/v1/__tests__/note-void-route.test.ts` (append two cases)

- [ ] **Step 1: Write the failing test**

Append to `src/app/api/v1/__tests__/note-void-route.test.ts`:

```ts
import { PUT as putCredit } from '../credit-notes/[id]/route';
import { PUT as putDebit } from '../debit-notes/[id]/route';

function putVoid(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'VOID' }),
  });
}

it('PUT status:VOID is rejected on a credit note (422, directs to /void)', async () => {
  const res = await putCredit(putVoid('/api/v1/credit-notes/cn-1'), cnParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('PUT status:VOID is rejected on a debit note (422, directs to /void)', async () => {
  const res = await putDebit(putVoid('/api/v1/debit-notes/dn-1'), dnParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/v1/__tests__/note-void-route.test.ts`
Expected: FAIL — the two new cases get the old behavior (transaction runs / not a 422).

- [ ] **Step 3: Write minimal implementation**

In `src/app/api/v1/credit-notes/[id]/route.ts`, inside `PUT`, immediately after `const body = await req.json();`, add:

```ts
    // Voiding a posted note must reverse its journal entry — that only happens
    // through the dedicated endpoint. A bare status flip here would leave the
    // posting entry live (the bug this guards against).
    if (body.status === 'VOID') {
      return withCors(
        NextResponse.json(
          { error: 'Void a posted credit note through POST /api/v1/credit-notes/:id/void' },
          { status: 422 },
        ),
      );
    }
```

In `src/app/api/v1/debit-notes/[id]/route.ts`, inside `PUT`, immediately after `const body = await req.json();`, add the same block with "debit note" and the `/api/v1/debit-notes/:id/void` path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/v1/__tests__/note-void-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/credit-notes/\[id\]/route.ts src/app/api/v1/debit-notes/\[id\]/route.ts src/app/api/v1/__tests__/note-void-route.test.ts
git commit -m "fix(notes): reject silent PUT status:VOID; require the void endpoint"
```

---

### Task 4: Integration round-trip (real Postgres)

Proves the whole-ledger invariant: apply → void leaves the trial balance and AR/AP control back at zero, with exactly two posted entries that net out.

**Files:**
- Create: `lib/__tests__/integration/note-void-invariants.int.test.ts`

**Prereq:** a reachable Postgres with a `<db>_test` database and the schema pushed (`DATABASE_URL=<test-url> npx prisma db push`). Same requirement as the existing `gl-invariants.int.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/integration/note-void-invariants.int.test.ts`:

```ts
/**
 * Void round-trip invariants for credit/debit notes: applying posts a balanced
 * entry; voiding reverses it so the trial balance and AR/AP control return to
 * zero, with exactly two posted entries (post + reversal) that net out.
 *
 * Run with:  npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { postCreditNoteOnApply } from '../../credit-note-posting';
import { postDebitNoteOnApply } from '../../debit-note-posting';
import { voidCreditNote, voidDebitNote } from '../../note-void';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createVendor,
  assertTrialBalanced,
  accountBalance,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-20T00:00:00.000Z');

describe('credit note void round-trip', () => {
  it('apply posts DR return / CR AR; void reverses both legs to zero', async () => {
    const org = await createTestOrg();
    const customerId = await createCustomer(org.orgId);

    const cn = await prisma.creditNote.create({
      data: {
        organizationId: org.orgId,
        number: 'CN-VOID-1',
        customerId,
        date: DATE,
        amount: 5000,
        applyTax: false,
        status: 'DRAFT',
        returnAccountId: org.accounts.salesRevenue,
        arAccountId: org.accounts.arControl,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) => postCreditNoteOnApply(tx, cn.id));
    await assertTrialBalanced(org.orgId, 'credit note applied');
    // AR control was credited 5000 (debit-positive => negative).
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(-5000, 2);

    await prisma.$transaction((tx) => voidCreditNote(tx, org.orgId, cn.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'credit note voided');
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(0, 2);
    expect(await journalEntryCount(org.orgId)).toBe(2); // post + reversal
    const voided = await prisma.creditNote.findUnique({ where: { id: cn.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});

describe('debit note void round-trip', () => {
  it('apply posts DR AP / CR return; void reverses both legs to zero', async () => {
    const org = await createTestOrg();
    const vendorId = await createVendor(org.orgId);

    const dn = await prisma.debitNote.create({
      data: {
        organizationId: org.orgId,
        number: 'DN-VOID-1',
        vendorId,
        date: DATE,
        amount: 4000,
        applyTax: false,
        status: 'DRAFT',
        apAccountId: org.accounts.apControl,
        returnAccountId: org.accounts.cogsExpense,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) => postDebitNoteOnApply(tx, dn.id));
    await assertTrialBalanced(org.orgId, 'debit note applied');
    // AP control was debited 4000 (debit-positive => positive).
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(4000, 2);

    await prisma.$transaction((tx) => voidDebitNote(tx, org.orgId, dn.id, { date: DATE }));

    await assertTrialBalanced(org.orgId, 'debit note voided');
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBeCloseTo(0, 2);
    expect(await journalEntryCount(org.orgId)).toBe(2);
    const voided = await prisma.debitNote.findUnique({ where: { id: dn.id }, select: { status: true } });
    expect(voided?.status).toBe('VOID');

    await cleanupOrg(org.orgId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails first, then passes**

Run: `npm run test:int -- lib/__tests__/integration/note-void-invariants.int.test.ts`
Expected: PASS (2 tests). If it errors with a connection/`_test` DB message, the test DB isn't set up — provision it per the prereq, then re-run. (If `postCreditNoteOnApply` rejects an explicit account that isn't postable, confirm the harness seeds `salesRevenue`/`arControl`/`apControl`/`cogsExpense` as `isPostable: true` — it does.)

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/integration/note-void-invariants.int.test.ts
git commit -m "test(notes): integration void round-trip for credit/debit notes"
```

---

### Task 5: React Query void hooks

**Files:**
- Modify: `src/hooks/useReturns.ts` (add two hooks near the other credit/debit note hooks ~line 299-380; edit `CN_STATUS_UP` ~line 45 and `DN_STATUS_UP` ~line 48)

- [ ] **Step 1: Add the hooks**

In `src/hooks/useReturns.ts`, add (e.g. directly after `useUpdateCreditNote` / `useUpdateDebitNote` respectively):

```ts
export function useVoidCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/credit-notes/${id}/void`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creditNotes'] }),
  });
}

export function useVoidDebitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/debit-notes/${id}/void`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debitNotes'] }),
  });
}
```

- [ ] **Step 2: Remove `Void` from the up-maps**

Change line ~45 from:

```ts
const CN_STATUS_UP:   Record<string, string>           = { Draft: 'DRAFT', Applied: 'APPLIED', Void: 'VOID' };
```

to:

```ts
const CN_STATUS_UP:   Record<string, string>           = { Draft: 'DRAFT', Applied: 'APPLIED' };
```

Change line ~48 from:

```ts
const DN_STATUS_UP:   Record<string, string>           = { Draft: 'DRAFT', Applied: 'APPLIED', Void: 'VOID' };
```

to:

```ts
const DN_STATUS_UP:   Record<string, string>           = { Draft: 'DRAFT', Applied: 'APPLIED' };
```

Leave the `*_STATUS_DOWN` maps (with `VOID: 'Void'`) unchanged — voided notes still need to display.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useReturns.ts
git commit -m "feat(notes): useVoidCreditNote/useVoidDebitNote hooks; drop Void up-map"
```

---

### Task 6: Void action in `CreditNotes.tsx`

**Files:**
- Modify: `src/views/ar/CreditNotes.tsx`

- [ ] **Step 1: Import the hook**

In the import from `'../../hooks/useReturns'` (line 12), add `useVoidCreditNote`:

```ts
import { useCreditNotes, useSalesReturns, useWarehouses, useVoidCreditNote } from '../../hooks/useReturns';
```

- [ ] **Step 2: Add the hook + handler**

Inside the `CreditNotes` component, after `const { data: cnData } = useCreditNotes();` (line 52), add:

```ts
    const voidCreditNote = useVoidCreditNote();

    const handleVoidCredit = (id: string) => {
        if (!window.confirm('Void this credit note? Its journal entry will be reversed. This cannot be undone.')) return;
        voidCreditNote.mutate(id, {
            onError: (error: unknown) => {
                window.alert(error instanceof Error ? error.message : 'Failed to void credit note');
            },
        });
    };
```

- [ ] **Step 3: Add the Void button to the credit-note actions column**

In `creditColumns`, in the `actions` render (lines 174-180), add a Void button before the `View` button (shown only for applied notes):

```tsx
                <div className="row-actions-end">
                    {(row['status'] as string) === 'Applied' && (
                        <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidCreditNote.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoidCredit(row['id'] as string); }} />
                    )}
                    <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openDoc('credit', row['id'] as string); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); queuePrintCredit(row['id'] as string); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate('/ar/credits/edit', { state: { mode: 'edit', creditId: row['id'] as string } }); }} />
                </div>
```

- [ ] **Step 4: Add the Void button to the detail header**

In the `selectedCredit` workbench header actions (lines 331-334), add a Void button (shown only when the open note is applied):

```tsx
                        <div className="detail-header-actions">
                            {selectedCredit.status === 'Applied' && (
                                <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidCreditNote.isPending} onClick={() => handleVoidCredit(selectedCredit.id)} />
                            )}
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintCredit(selectedCredit.id)} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ar/credits/edit', { state: { mode: 'edit', creditId: selectedCredit.id } })} />
                        </div>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/ar/CreditNotes.tsx
git commit -m "feat(ar): Void action on applied credit notes"
```

---

### Task 7: Void action in `DebitNotes.tsx`

**Files:**
- Modify: `src/views/ap/DebitNotes.tsx`

- [ ] **Step 1: Import the hook**

In the import from `'../../hooks/useReturns'` (line 11), add `useVoidDebitNote`:

```ts
import { useDebitNotes, usePurchaseReturns, useWarehouses, useVoidDebitNote } from '../../hooks/useReturns';
```

- [ ] **Step 2: Add the hook + handler**

Inside the `DebitNotes` component, just after the `useDebitNotes()` call (line 40), add:

```ts
    const voidDebitNote = useVoidDebitNote();

    const handleVoidDebit = (id: string) => {
        if (!window.confirm('Void this debit note? Its journal entry will be reversed. This cannot be undone.')) return;
        voidDebitNote.mutate(id, {
            onError: (error: unknown) => {
                window.alert(error instanceof Error ? error.message : 'Failed to void debit note');
            },
        });
    };
```

- [ ] **Step 3: Add the Void button to the debit-note actions column**

In the debit-note `actions` render (around line 182-189, the block starting with the `View` button at line 186), add a Void button before `View`:

```tsx
                    {(row['status'] as string) === 'Applied' && (
                        <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidDebitNote.isPending} onClick={(event: React.MouseEvent) => { event.stopPropagation(); handleVoidDebit(row['id'] as string); }} />
                    )}
                    <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); openDoc('debit', row['id'] as string); }} />
```

- [ ] **Step 4: Add the Void button to the detail header**

In the `selectedDebitNote` workbench header actions (around line 340-342, before the `Print` button at line 341), add:

```tsx
                            {selectedDebitNote.status === 'Applied' && (
                                <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidDebitNote.isPending} onClick={() => handleVoidDebit(selectedDebitNote.id)} />
                            )}
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintDebit(selectedDebitNote.id)} />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/ap/DebitNotes.tsx
git commit -m "feat(ap): Void action on applied debit notes"
```

---

### Task 8: Full verification

- [ ] **Step 1: Unit suite**

Run: `npm test`
Expected: all green, including `note-void.test.ts` (6) and `note-void-route.test.ts` (5).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Integration suite** (requires the `<db>_test` database)

Run: `npm run test:int`
Expected: all green, including `note-void-invariants.int.test.ts` (2).

- [ ] **Step 4: Manual smoke (optional, dev server)**

Apply a credit note, then click **Void**. Confirm the status becomes `Void`, the action disappears, and the GL/journal report shows a matching reversal entry. (See `project_dev_servers` for starting the two dev servers; auth bypass notes in CLAUDE.md.)

---

## Self-Review (completed during planning)

- **Spec coverage:** lib core (Task 1), routes (Task 2), close silent path (Task 3), integration round-trip (Task 4), hooks (Task 5), UI credit + debit (Tasks 6-7), verification (Task 8) — every spec section maps to a task. ✓
- **No migration:** confirmed — `status`/`journalEntryId`/`postedAt` already exist; `VOID` already in both enums. ✓
- **Type/name consistency:** `voidCreditNote`/`voidDebitNote(tx, orgId, id, { date })` used identically in lib, routes, and integration test; hooks invalidate `['creditNotes']`/`['debitNotes']` matching the existing query keys. ✓
- **Guards mirror payment-void:** 404 / already-void 422 / not-posted 422 / `assertPeriodOpen` — same shape, lower surface (no allocations to clear). ✓
