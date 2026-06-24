# Approval Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approval enforcement real and server-enforced for **Invoices and Purchase Orders** — moving the config server-side, auto-routing finalize through approval when required, and surfacing pending work in a dashboard widget — as the reusable engine the later phases extend.

**Architecture:** A small `lib/approval/` engine: pure config/policy helpers (unit-tested), a `routeForApproval` guard called at each finalize point, and `approveRequest`/`rejectRequest` that dispatch to per-document-type *finalizers* (which reuse existing posting libs). Config lives on `Organization` (JSON), enforced server-side; per-role approve rights live on `RolePermission.canApprove`. Auto-route at finalize: the normal finalize transition checks the guard and, when approval is required and not yet granted, holds the document at `PENDING_APPROVAL` instead of posting.

**Tech Stack:** Next.js API routes (`withHandler`), Prisma (`prisma db push`, no migrations), Vitest (`npm test` unit, `npm run test:int` real-Postgres integration), React 19 + React Query + Zustand.

**Spec:** `docs/superpowers/specs/2026-06-23-approval-engine-design.md`

**Phase-1 corrections to the spec (confirmed against the codebase):**
- `ApprovalRequest.documentType` enum already has `INVOICE` and `PURCHASE_ORDER` — **no enum widening needed in Phase 1** (Phase 2/3 add values).
- The rejection reason uses the **existing `ApprovalRequest.note`** field (spec said `rejectionReason`).
- The existing invoice `approve` route sets status `SENT` **without posting COGS/GL** (latent bug). Extracting the send-posting into a reusable function and routing approval through it **fixes that bug**.
- There is **no server roles-write API**; the Security & Roles matrix is client-only and `auth/me` returns the logged-in user's permissions. Phase 1 enables **admins** to approve out of the box (seeded). Granting non-admin roles `canApprove` from the UI is a flagged follow-up (needs a roles-write API).

---

## File Structure

**New files:**
- `lib/approval/config.ts` — module keys, `ApprovalRequirements` type, defaults, `normalizeApprovalRequirements`, `requiresApproval` (pure).
- `lib/approval/policy.ts` — `isApprovalAllowed` self-approval/permission decision (pure).
- `lib/approval/registry.ts` — `ApprovalDocumentType → { configKey, moduleKey }` descriptor table.
- `lib/approval/can-approve.ts` — `userCanApprove`, `assertCanApprove` (DB-backed).
- `lib/approval/finalizers.ts` — `documentType → finalize(tx, orgId, documentId)` dispatch.
- `lib/approval/engine.ts` — `routeForApproval`, `approveRequest`, `rejectRequest`.
- `lib/invoice-send-posting.ts` — `postInvoiceSend(tx, orgId, invoiceId)` (extracted from the invoice route; loads the invoice's own issueDate for the period guard).
- `src/app/api/v1/approvals/[id]/approve/route.ts`, `src/app/api/v1/approvals/[id]/reject/route.ts` — generic engine routes.
- `src/components/dashboard/widgets/PendingApprovalsWidget.tsx` — the dashboard widget.
- `lib/approval/__tests__/config.test.ts`, `lib/approval/__tests__/policy.test.ts` — unit tests.
- `lib/__tests__/integration/approval-engine.int.test.ts` — integration proof.

**Modified files:**
- `prisma/schema.prisma` — `RolePermission.canApprove`; `Organization.approvalRequirements`, `Organization.requireDistinctApproverForAdmins`.
- `prisma/seed.ts` — seed `canApprove: true` on admin permissions.
- `src/app/api/v1/invoices/[id]/route.ts` — call `postInvoiceSend`; auto-route on DRAFT→SENT.
- `src/app/api/v1/purchase-orders/[id]/route.ts` — auto-route on DRAFT→APPROVED (verify exact finalize path during the task).
- `src/app/api/v1/invoices/[id]/approve/route.ts`, `.../reject/route.ts`, PO equivalents — delegate to the engine.
- `src/app/api/v1/organization/settings/route.ts` — read/write the two new Organization fields.
- `src/app/api/v1/auth/me/route.ts` (+ `login`, `google`) — already select `permissions: true`; confirm `canApprove` flows through.
- `src/stores/useAccessStore.ts` — map `canApprove → approve`; `canApproveAny()`.
- `src/config/dashboardWidgets.ts`, `src/views/Dashboard.tsx` — register + gate the widget.
- `src/views/ar/ApprovalInbox.tsx` — reject reason + button gating + generic routes.
- `src/views/settings/Settings.tsx` — approvals tab reads/writes server config.
- `src/views/settings/*` Security & Roles matrix — add an "Approve" column (cosmetic note).

---

## Task 1: Schema + seed — `canApprove`, `approvalRequirements`, admin toggle

**Files:**
- Modify: `prisma/schema.prisma` (`RolePermission`, `Organization`)
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add fields to schema.** In `prisma/schema.prisma`, add to `model RolePermission` (after `canDelete`):

```prisma
  canApprove  Boolean   @default(false)
```

In `model Organization`, add (next to `accountDefaults Json?`):

```prisma
  approvalRequirements             Json?
  requireDistinctApproverForAdmins Boolean @default(false)
```

- [ ] **Step 2: Apply + regenerate.**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema." + client regenerated.

- [ ] **Step 3: Seed admin `canApprove`.** In `prisma/seed.ts`, in the admin `rolePermission.createMany` mapping, add `canApprove: true`:

```typescript
    data: ALL_MODULE_KEYS.map((moduleKey) => ({
      roleId: role.id,
      moduleKey,
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canApprove: true,
    })),
```

- [ ] **Step 4: Re-seed + typecheck.**

Run: `npm run db:seed && npm run typecheck`
Expected: seed completes; `tsc --noEmit` reports no new errors.

- [ ] **Step 5: Commit.**

```bash
git add prisma/schema.prisma prisma/seed.ts
git commit -m "feat(approval): schema — canApprove + org approvalRequirements + admin-approver toggle"
```

---

## Task 2: `lib/approval/config.ts` — pure config helpers (TDD)

**Files:**
- Create: `lib/approval/config.ts`
- Test: `lib/approval/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODULE_KEYS,
  DEFAULT_APPROVAL_REQUIREMENTS,
  normalizeApprovalRequirements,
  requiresApproval,
} from '../config';

describe('approval config helpers', () => {
  it('defaults every module to false', () => {
    expect(APPROVAL_MODULE_KEYS).toHaveLength(10);
    expect(Object.values(DEFAULT_APPROVAL_REQUIREMENTS).every((v) => v === false)).toBe(true);
  });

  it('normalize merges partial/raw over defaults and drops unknown keys', () => {
    const out = normalizeApprovalRequirements({ ar_invoices: true, bogus_key: true });
    expect(out.ar_invoices).toBe(true);
    expect(out.ap_pos).toBe(false);
    expect((out as Record<string, unknown>).bogus_key).toBeUndefined();
  });

  it('normalize is safe on null/undefined/non-object', () => {
    expect(normalizeApprovalRequirements(null).ar_invoices).toBe(false);
    expect(normalizeApprovalRequirements(undefined).ap_pos).toBe(false);
    expect(normalizeApprovalRequirements('nope').inv_adj).toBe(false);
  });

  it('requiresApproval reads the flag, false when config missing', () => {
    expect(requiresApproval({ ...DEFAULT_APPROVAL_REQUIREMENTS, ar_invoices: true }, 'ar_invoices')).toBe(true);
    expect(requiresApproval(DEFAULT_APPROVAL_REQUIREMENTS, 'ar_invoices')).toBe(false);
    expect(requiresApproval(null, 'ar_invoices')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npm test -- lib/approval/__tests__/config.test.ts`
Expected: FAIL — cannot resolve `../config`.

- [ ] **Step 3: Implement `lib/approval/config.ts`.**

```typescript
export const APPROVAL_MODULE_KEYS = [
  'ar_sales_orders',
  'ar_invoices',
  'ar_payments',
  'ar_credits',
  'ap_pos',
  'ap_bills',
  'ap_payments',
  'ap_debits',
  'inv_adj',
  'hr_payroll',
] as const;

export type ApprovalModuleKey = (typeof APPROVAL_MODULE_KEYS)[number];
export type ApprovalRequirements = Record<ApprovalModuleKey, boolean>;

export const DEFAULT_APPROVAL_REQUIREMENTS: ApprovalRequirements =
  APPROVAL_MODULE_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as ApprovalRequirements);

export function normalizeApprovalRequirements(raw: unknown): ApprovalRequirements {
  const out: ApprovalRequirements = { ...DEFAULT_APPROVAL_REQUIREMENTS };
  if (raw && typeof raw === 'object') {
    for (const key of APPROVAL_MODULE_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

export function requiresApproval(
  reqs: ApprovalRequirements | null | undefined,
  key: ApprovalModuleKey,
): boolean {
  return reqs?.[key] === true;
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npm test -- lib/approval/__tests__/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/approval/config.ts lib/approval/__tests__/config.test.ts
git commit -m "feat(approval): pure config helpers (module keys, normalize, requiresApproval)"
```

---

## Task 3: `lib/approval/policy.ts` — self-approval/permission decision (TDD)

**Files:**
- Create: `lib/approval/policy.ts`
- Test: `lib/approval/__tests__/policy.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, expect, it } from 'vitest';
import { isApprovalAllowed } from '../policy';

const base = { hasCanApprove: true, isSelf: false, roleType: 'ACCOUNTANT', requireDistinctApproverForAdmins: false };

describe('isApprovalAllowed', () => {
  it('blocks when the user lacks canApprove', () => {
    expect(isApprovalAllowed({ ...base, hasCanApprove: false })).toEqual({ allowed: false, reason: 'no-permission' });
  });

  it('allows a different approver with permission', () => {
    expect(isApprovalAllowed(base)).toEqual({ allowed: true });
  });

  it('blocks self-approval for non-admins', () => {
    expect(isApprovalAllowed({ ...base, isSelf: true })).toEqual({ allowed: false, reason: 'self-approval' });
  });

  it('admins may self-approve by default (admins exempt)', () => {
    expect(isApprovalAllowed({ ...base, isSelf: true, roleType: 'ADMIN' })).toEqual({ allowed: true });
  });

  it('admins may NOT self-approve when the tightening toggle is on', () => {
    expect(isApprovalAllowed({ ...base, isSelf: true, roleType: 'ADMIN', requireDistinctApproverForAdmins: true }))
      .toEqual({ allowed: false, reason: 'self-approval' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npm test -- lib/approval/__tests__/policy.test.ts`
Expected: FAIL — cannot resolve `../policy`.

- [ ] **Step 3: Implement `lib/approval/policy.ts`.**

```typescript
export interface ApprovalDecisionInput {
  hasCanApprove: boolean;
  isSelf: boolean;
  roleType: string;
  requireDistinctApproverForAdmins: boolean;
}

export type ApprovalDecision =
  | { allowed: true }
  | { allowed: false; reason: 'no-permission' | 'self-approval' };

export function isApprovalAllowed(input: ApprovalDecisionInput): ApprovalDecision {
  if (!input.hasCanApprove) return { allowed: false, reason: 'no-permission' };
  if (input.isSelf) {
    const adminExempt = input.roleType === 'ADMIN' && !input.requireDistinctApproverForAdmins;
    if (!adminExempt) return { allowed: false, reason: 'self-approval' };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npm test -- lib/approval/__tests__/policy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/approval/policy.ts lib/approval/__tests__/policy.test.ts
git commit -m "feat(approval): self-approval/permission decision policy"
```

---

## Task 4: `lib/approval/registry.ts` — document-type descriptors

**Files:**
- Create: `lib/approval/registry.ts`

- [ ] **Step 1: Implement.** (No separate test — it is a constant table exercised by the engine integration test in Task 9.)

```typescript
import type { ApprovalDocumentType, ModuleKey } from '@prisma/client';
import type { ApprovalModuleKey } from './config';

export interface ApprovalDescriptor {
  documentType: ApprovalDocumentType;
  configKey: ApprovalModuleKey; // key in Organization.approvalRequirements
  moduleKey: ModuleKey;         // RolePermission.moduleKey used for canApprove
}

// Phase 1 covers INVOICE + PURCHASE_ORDER. Phase 2/3 add entries here.
export const APPROVAL_REGISTRY: Partial<Record<ApprovalDocumentType, ApprovalDescriptor>> = {
  INVOICE: { documentType: 'INVOICE', configKey: 'ar_invoices', moduleKey: 'AR_INVOICES' },
  PURCHASE_ORDER: { documentType: 'PURCHASE_ORDER', configKey: 'ap_pos', moduleKey: 'AP_POS' },
};

export function getDescriptor(documentType: ApprovalDocumentType): ApprovalDescriptor {
  const d = APPROVAL_REGISTRY[documentType];
  if (!d) throw new Error(`No approval descriptor for documentType ${documentType}`);
  return d;
}
```

- [ ] **Step 2: Typecheck + commit.**

Run: `npm run typecheck`
Expected: no new errors.

```bash
git add lib/approval/registry.ts
git commit -m "feat(approval): document-type → config/module descriptor registry"
```

---

## Task 5: `lib/approval/can-approve.ts` — DB-backed authorization

**Files:**
- Create: `lib/approval/can-approve.ts`

- [ ] **Step 1: Implement.** (Behavior verified by the integration test in Task 9, which seeds roles with/without `canApprove`.)

```typescript
import type { NextRequest } from 'next/server';
import type { ModuleKey, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { isApprovalAllowed } from './policy';

type Db = Prisma.TransactionClient | typeof prisma;

/** True if the user may approve documents in `moduleKey`. Admins approve everything. */
export async function userCanApprove(
  db: Db,
  orgId: string,
  userId: string,
  roleType: string,
  moduleKey: ModuleKey,
): Promise<boolean> {
  if (roleType === 'ADMIN') return true;
  const membership = await db.userOrganization.findFirst({
    where: { userId, organizationId: orgId },
    select: { role: { select: { permissions: { where: { moduleKey }, select: { canApprove: true } } } } },
  });
  return membership?.role.permissions[0]?.canApprove ?? false;
}

/** Throws ApiError(403) if the (user, document submitter) pair may not approve. */
export async function assertApprovalAuthorized(
  db: Db,
  args: {
    orgId: string;
    userId: string;
    roleType: string;
    moduleKey: ModuleKey;
    requestedById: string;
    requireDistinctApproverForAdmins: boolean;
  },
): Promise<void> {
  const hasCanApprove = await userCanApprove(db, args.orgId, args.userId, args.roleType, args.moduleKey);
  const decision = isApprovalAllowed({
    hasCanApprove,
    isSelf: args.requestedById === args.userId,
    roleType: args.roleType,
    requireDistinctApproverForAdmins: args.requireDistinctApproverForAdmins,
  });
  if (decision.allowed) return;
  if (decision.reason === 'self-approval') {
    throw new ApiError('You cannot approve a document you submitted', 403);
  }
  throw new ApiError('You do not have permission to approve this document', 403);
}

/** Header-driven org/user/role extraction for routes. */
export function approvalActor(req: NextRequest): { orgId: string; userId: string; roleType: string } {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  const roleType = req.headers.get('x-role-type') ?? '';
  if (!orgId || !userId) throw new ApiError('Unauthenticated', 401);
  return { orgId, userId, roleType };
}
```

- [ ] **Step 2: Typecheck + commit.**

Run: `npm run typecheck`
Expected: no new errors.

```bash
git add lib/approval/can-approve.ts
git commit -m "feat(approval): canApprove lookup + self-approval authorization guard"
```

---

## Task 6: Extract `postInvoiceSend` (fixes the approve-without-posting bug)

**Files:**
- Create: `lib/invoice-send-posting.ts`
- Modify: `src/app/api/v1/invoices/[id]/route.ts` (the `DRAFT → SENT` block, ~lines 100–270)

- [ ] **Step 1: Read the current DRAFT→SENT block.** Open `src/app/api/v1/invoices/[id]/route.ts`. Identify the code that runs when `existing.status === 'DRAFT' && header.status === 'SENT'`: `assertPeriodOpen`, the AR/Sales/Output-Tax `postJournalEntry`, and the per-inventory-line `calculateAndPostCOGS` + COGS/Inventory `postJournalEntry`.

- [ ] **Step 2: Create `lib/invoice-send-posting.ts`** exporting a faithful extraction (no behavior change). Signature:

```typescript
import type { Prisma } from '@prisma/client';

/**
 * Posts the GL + COGS for an invoice transitioning to SENT.
 * Moved verbatim from invoices/[id] PUT (DRAFT→SENT). Must run inside a $transaction.
 * Does NOT change invoice.status — the caller sets SENT.
 */
export async function postInvoiceSend(
  tx: Prisma.TransactionClient,
  orgId: string,
  invoiceId: string,
): Promise<void> {
  // ... exact logic moved from the route: assertPeriodOpen(tx, orgId, issueDate),
  //     AR/Sales/Output-Tax postJournalEntry, per-line calculateAndPostCOGS + COGS/Inventory JE.
  //     Load whatever the route loaded (lines, accounts) from `tx` here instead of the route.
}
```

Move the imports it needs (`assertPeriodOpen`, `calculateAndPostCOGS`, `postJournalEntry`) into this file.

- [ ] **Step 3: Call it from the route.** In `invoices/[id]/route.ts`, replace the inlined block with `await postInvoiceSend(tx, existing.organizationId, existing.id);` (keep the surrounding `status: 'SENT'` update). Leave the auto-route wiring for Task 8.

- [ ] **Step 4: Verify existing invoice behavior is unchanged.**

Run: `npm run typecheck && npm run test:int`
Expected: typecheck clean; existing invoice/GL integration tests still pass (proves the extraction is faithful).

- [ ] **Step 5: Commit.**

```bash
git add lib/invoice-send-posting.ts "src/app/api/v1/invoices/[id]/route.ts"
git commit -m "refactor(invoices): extract postInvoiceSend (reused by approval finalizer)"
```

---

## Task 7: `lib/approval/finalizers.ts` + `lib/approval/engine.ts`

**Files:**
- Create: `lib/approval/finalizers.ts`
- Create: `lib/approval/engine.ts`

- [ ] **Step 1: Implement `lib/approval/finalizers.ts`.** Each finalizer performs the real go-live transition for one document type.

```typescript
import type { ApprovalDocumentType, Prisma } from '@prisma/client';
import { postInvoiceSend } from '@/lib/invoice-send-posting';

export type Finalizer = (tx: Prisma.TransactionClient, orgId: string, documentId: string) => Promise<void>;

export const FINALIZERS: Partial<Record<ApprovalDocumentType, Finalizer>> = {
  INVOICE: async (tx, orgId, documentId) => {
    await postInvoiceSend(tx, orgId, documentId);
    await tx.salesInvoice.update({ where: { id: documentId }, data: { status: 'SENT', updatedAt: new Date() } });
  },
  PURCHASE_ORDER: async (tx, _orgId, documentId) => {
    // POs post no GL at approval; going live = APPROVED status.
    await tx.purchaseOrder.update({ where: { id: documentId }, data: { status: 'APPROVED', updatedAt: new Date() } });
  },
};

export function getFinalizer(documentType: ApprovalDocumentType): Finalizer {
  const fn = FINALIZERS[documentType];
  if (!fn) throw new Error(`No finalizer for documentType ${documentType}`);
  return fn;
}
```

- [ ] **Step 2: Implement `lib/approval/engine.ts`.**

```typescript
import type { ApprovalDocumentType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { logAuditTx } from '@/lib/api-utils';
import { normalizeApprovalRequirements, requiresApproval } from './config';
import { getDescriptor } from './registry';
import { getFinalizer } from './finalizers';
import { assertApprovalAuthorized } from './can-approve';

/**
 * Decide whether finalizing should be held for approval.
 * Returns true if it routed (caller must STOP and set its holding status);
 * false if no approval is needed / already granted (caller proceeds to finalize).
 */
export async function routeForApproval(
  tx: Prisma.TransactionClient,
  args: { orgId: string; userId: string; documentType: ApprovalDocumentType; documentId: string },
): Promise<boolean> {
  const org = await tx.organization.findUnique({
    where: { id: args.orgId },
    select: { approvalRequirements: true },
  });
  const reqs = normalizeApprovalRequirements(org?.approvalRequirements);
  const { configKey } = getDescriptor(args.documentType);
  if (!requiresApproval(reqs, configKey)) return false;

  const alreadyApproved = await tx.approvalRequest.findFirst({
    where: { organizationId: args.orgId, documentType: args.documentType, documentId: args.documentId, status: 'APPROVED' },
    select: { id: true },
  });
  if (alreadyApproved) return false; // approver path: let the finalize proceed

  const open = await tx.approvalRequest.findFirst({
    where: { organizationId: args.orgId, documentType: args.documentType, documentId: args.documentId, status: 'PENDING' },
    select: { id: true },
  });
  if (!open) {
    await tx.approvalRequest.create({
      data: {
        organizationId: args.orgId,
        documentType: args.documentType,
        documentId: args.documentId,
        requestedById: args.userId,
        requestedAt: new Date(),
        status: 'PENDING',
      },
    });
  }
  return true;
}

/** Approve a pending request: authorize, run the finalizer, mark APPROVED. */
export async function approveRequest(
  approvalRequestId: string,
  actor: { orgId: string; userId: string; roleType: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reqRow = await tx.approvalRequest.findFirst({
      where: { id: approvalRequestId, organizationId: actor.orgId },
      select: { id: true, documentType: true, documentId: true, requestedById: true, status: true },
    });
    if (!reqRow) throw new ApiError('Approval request not found', 404);
    if (reqRow.status !== 'PENDING') throw new ApiError(`Approval request is ${reqRow.status}, not PENDING`, 400);

    const org = await tx.organization.findUnique({
      where: { id: actor.orgId },
      select: { requireDistinctApproverForAdmins: true },
    });
    const { moduleKey } = getDescriptor(reqRow.documentType);
    await assertApprovalAuthorized(tx, {
      orgId: actor.orgId,
      userId: actor.userId,
      roleType: actor.roleType,
      moduleKey,
      requestedById: reqRow.requestedById,
      requireDistinctApproverForAdmins: org?.requireDistinctApproverForAdmins ?? false,
    });

    await getFinalizer(reqRow.documentType)(tx, actor.orgId, reqRow.documentId);

    await tx.approvalRequest.update({
      where: { id: reqRow.id },
      data: { status: 'APPROVED', reviewedById: actor.userId, reviewedAt: new Date() },
    });
    await logAuditTx(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      entityType: 'ApprovalRequest',
      entityId: reqRow.id,
      action: 'UPDATE',
      payload: { action: 'approve', documentType: reqRow.documentType, documentId: reqRow.documentId },
    });
  });
}

/** Reject a pending request: revert the document to DRAFT, mark REJECTED with a note. */
export async function rejectRequest(
  approvalRequestId: string,
  actor: { orgId: string; userId: string; roleType: string },
  note?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reqRow = await tx.approvalRequest.findFirst({
      where: { id: approvalRequestId, organizationId: actor.orgId },
      select: { id: true, documentType: true, documentId: true, requestedById: true, status: true },
    });
    if (!reqRow) throw new ApiError('Approval request not found', 404);
    if (reqRow.status !== 'PENDING') throw new ApiError(`Approval request is ${reqRow.status}, not PENDING`, 400);

    const org = await tx.organization.findUnique({
      where: { id: actor.orgId },
      select: { requireDistinctApproverForAdmins: true },
    });
    const { moduleKey } = getDescriptor(reqRow.documentType);
    await assertApprovalAuthorized(tx, {
      orgId: actor.orgId,
      userId: actor.userId,
      roleType: actor.roleType,
      moduleKey,
      requestedById: reqRow.requestedById,
      requireDistinctApproverForAdmins: org?.requireDistinctApproverForAdmins ?? false,
    });

    if (reqRow.documentType === 'INVOICE') {
      await tx.salesInvoice.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT', updatedAt: new Date() } });
    } else if (reqRow.documentType === 'PURCHASE_ORDER') {
      await tx.purchaseOrder.update({ where: { id: reqRow.documentId }, data: { status: 'DRAFT', updatedAt: new Date() } });
    }

    await tx.approvalRequest.update({
      where: { id: reqRow.id },
      data: { status: 'REJECTED', reviewedById: actor.userId, reviewedAt: new Date(), ...(note ? { note } : {}) },
    });
    await logAuditTx(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      entityType: 'ApprovalRequest',
      entityId: reqRow.id,
      action: 'UPDATE',
      payload: { action: 'reject', documentType: reqRow.documentType, documentId: reqRow.documentId, note },
    });
  });
}
```

- [ ] **Step 3: Typecheck.**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit.**

```bash
git add lib/approval/finalizers.ts lib/approval/engine.ts
git commit -m "feat(approval): engine — routeForApproval, approveRequest, rejectRequest + finalizers"
```

---

## Task 8: Wire auto-route at finalize + generic/refactored routes

**Files:**
- Create: `src/app/api/v1/approvals/[id]/approve/route.ts`
- Create: `src/app/api/v1/approvals/[id]/reject/route.ts`
- Modify: `src/app/api/v1/invoices/[id]/route.ts` (DRAFT→SENT)
- Modify: `src/app/api/v1/purchase-orders/[id]/route.ts` (DRAFT→APPROVED finalize path — verify exact transition first)
- Modify: `src/app/api/v1/invoices/[id]/approve/route.ts`, `.../reject/route.ts`, PO `approve/route.ts`, `reject/route.ts`

- [ ] **Step 1: Generic approve route.** Create `src/app/api/v1/approvals/[id]/approve/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, withHandler } from '@/lib/api-utils';
import { approvalActor } from '@/lib/approval/can-approve';
import { approveRequest } from '@/lib/approval/engine';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withHandler(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = approvalActor(req);
  await approveRequest(id, actor);
  return ok({ success: true });
});
```

- [ ] **Step 2: Generic reject route.** Create `src/app/api/v1/approvals/[id]/reject/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, withHandler } from '@/lib/api-utils';
import { approvalActor } from '@/lib/approval/can-approve';
import { rejectRequest } from '@/lib/approval/engine';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withHandler(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = approvalActor(req);
  const body = await req.json().catch(() => ({}));
  await rejectRequest(id, actor, typeof body?.note === 'string' ? body.note : undefined);
  return ok({ success: true });
});
```

- [ ] **Step 3: Auto-route the invoice finalize.** In `src/app/api/v1/invoices/[id]/route.ts`, inside the `$transaction`, at the `DRAFT → SENT` branch, BEFORE posting:

```typescript
import { routeForApproval } from '@/lib/approval/engine';
// ...
const userId = req.headers.get('x-user-id')!;
const routed = await routeForApproval(tx, {
  orgId: existing.organizationId, userId, documentType: 'INVOICE', documentId: existing.id,
});
if (routed) {
  await tx.salesInvoice.update({ where: { id: existing.id }, data: { status: 'PENDING_APPROVAL', updatedAt: new Date() } });
  return; // do NOT post; response below reports routed
}
await postInvoiceSend(tx, existing.organizationId, existing.id);
// existing status:'SENT' update stays
```

After the transaction, the route should respond normally; the invoice's status (`PENDING_APPROVAL` vs `SENT`) communicates the outcome to the client.

- [ ] **Step 4: Auto-route the PO finalize.** Open `src/app/api/v1/purchase-orders/[id]/route.ts`, find the transition that sets `APPROVED` (the PO "finalize"/confirm path). Add, before it sets APPROVED:

```typescript
import { routeForApproval } from '@/lib/approval/engine';
// inside the tx, at DRAFT → APPROVED:
const routed = await routeForApproval(tx, {
  orgId, userId, documentType: 'PURCHASE_ORDER', documentId: id,
});
if (routed) {
  await tx.purchaseOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL', updatedAt: new Date() } });
  return;
}
// else: existing APPROVED transition proceeds
```

If the PO has no PUT-driven DRAFT→APPROVED path (only the manual `submit-approval`/`approve` routes), note that in the task and rely on those routes (already refactored in Step 5) — the auto-route then applies wherever a direct APPROVED transition exists.

- [ ] **Step 5: Refactor the four per-document approve/reject routes to delegate.** Replace the bodies of `invoices/[id]/approve`, `invoices/[id]/reject`, `purchase-orders/[id]/approve`, `purchase-orders/[id]/reject` to (a) resolve the open `PENDING` `ApprovalRequest` for that document, then (b) call `approveRequest`/`rejectRequest`. Example for `invoices/[id]/approve/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, withHandler } from '@/lib/api-utils';
import { approvalActor } from '@/lib/approval/can-approve';
import { approveRequest } from '@/lib/approval/engine';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withHandler(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = approvalActor(req);
  const reqRow = await prisma.approvalRequest.findFirst({
    where: { organizationId: actor.orgId, documentType: 'INVOICE', documentId: id, status: 'PENDING' },
    orderBy: { requestedAt: 'desc' }, select: { id: true },
  });
  if (!reqRow) return err('No pending approval request found for this invoice', 404);
  await approveRequest(reqRow.id, actor);
  return ok({ success: true });
});
```

Mirror for the reject routes (call `rejectRequest`, pass `note` from body) and the PO routes (`documentType: 'PURCHASE_ORDER'`). This removes the hardcoded `x-role-type === 'ADMIN'` gate (the engine now enforces `canApprove` + self-approval) and **fixes the invoice approve-without-posting bug** (the finalizer posts the GL).

- [ ] **Step 6: Typecheck.**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/api/v1/approvals" "src/app/api/v1/invoices/[id]" "src/app/api/v1/purchase-orders/[id]"
git commit -m "feat(approval): auto-route at finalize + generic approve/reject routes (delegating engine)"
```

---

## Task 9: Integration tests — the proof (TDD)

**Files:**
- Test: `lib/__tests__/integration/approval-engine.int.test.ts`

- [ ] **Step 1: Write the integration test.** Uses the real-Postgres harness. Helper inline to seed a role + user + membership (the harness's `createTestOrg` does not create users/roles).

```typescript
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, createCustomer, assertTrialBalanced, journalEntryCount, cleanupOrg, disconnect } from './harness';
import { routeForApproval, approveRequest, rejectRequest } from '../../approval/engine';

afterAll(async () => { await disconnect(); });

const DATE = new Date('2026-04-10T00:00:00.000Z');

// Create a user with a role that has canApprove on AR_INVOICES (or not).
async function seedUser(orgId: string, roleType: 'ADMIN' | 'ACCOUNTANT', canApprove: boolean) {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `${roleType}-${canApprove}-${Math.floor(performance.now())}`, roleType,
      permissions: { create: [{ moduleKey: 'AR_INVOICES', canView: true, canCreate: true, canEdit: true, canApprove }] } },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { email: `u-${role.id}@test.local`, fullName: 'T', passwordHash: 'x', status: 'ACTIVE' }, select: { id: true },
  });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } });
  return user.id;
}

async function makeDraftInvoice(orgId: string) {
  const customerId = await createCustomer(orgId);
  const inv = await prisma.salesInvoice.create({
    data: { organizationId: orgId, number: `INV-${Math.floor(performance.now())}`, customerId, issueDate: DATE,
      dueDate: DATE, status: 'DRAFT', totalAmount: 0 },
    select: { id: true },
  });
  return inv.id;
}

async function setRequirement(orgId: string, on: boolean) {
  await prisma.organization.update({ where: { id: orgId }, data: { approvalRequirements: { ar_invoices: on } } });
}

describe('approval engine — invoice routing/approve/reject', () => {
  it('requirement OFF: routeForApproval returns false (caller finalizes normally)', async () => {
    const org = await createTestOrg();
    await setRequirement(org.orgId, false);
    const staff = await seedUser(org.orgId, 'ACCOUNTANT', false);
    const invId = await makeDraftInvoice(org.orgId);
    const routed = await prisma.$transaction((tx) =>
      routeForApproval(tx, { orgId: org.orgId, userId: staff, documentType: 'INVOICE', documentId: invId }));
    expect(routed).toBe(false);
    await cleanupOrg(org.orgId);
  });

  it('requirement ON: routes (PENDING request created), posts NOTHING', async () => {
    const org = await createTestOrg();
    await setRequirement(org.orgId, true);
    const staff = await seedUser(org.orgId, 'ACCOUNTANT', false);
    const invId = await makeDraftInvoice(org.orgId);
    const routed = await prisma.$transaction((tx) =>
      routeForApproval(tx, { orgId: org.orgId, userId: staff, documentType: 'INVOICE', documentId: invId }));
    expect(routed).toBe(true);
    expect(await journalEntryCount(org.orgId)).toBe(0);
    const reqs = await prisma.approvalRequest.count({ where: { organizationId: org.orgId, documentId: invId, status: 'PENDING' } });
    expect(reqs).toBe(1);
    await cleanupOrg(org.orgId);
  });

  it('non-approver cannot approve (403)', async () => {
    const org = await createTestOrg();
    await setRequirement(org.orgId, true);
    const staff = await seedUser(org.orgId, 'ACCOUNTANT', false);
    const invId = await makeDraftInvoice(org.orgId);
    await prisma.$transaction((tx) => routeForApproval(tx, { orgId: org.orgId, userId: staff, documentType: 'INVOICE', documentId: invId }));
    const reqRow = await prisma.approvalRequest.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: invId, status: 'PENDING' }, select: { id: true } });
    await expect(approveRequest(reqRow.id, { orgId: org.orgId, userId: staff, roleType: 'ACCOUNTANT' }))
      .rejects.toThrow(/permission/i);
    await cleanupOrg(org.orgId);
  });

  it('self-approval blocked for non-admin submitter who DOES have canApprove', async () => {
    const org = await createTestOrg();
    await setRequirement(org.orgId, true);
    const approverWhoSubmitted = await seedUser(org.orgId, 'ACCOUNTANT', true);
    const invId = await makeDraftInvoice(org.orgId);
    await prisma.$transaction((tx) => routeForApproval(tx, { orgId: org.orgId, userId: approverWhoSubmitted, documentType: 'INVOICE', documentId: invId }));
    const reqRow = await prisma.approvalRequest.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: invId, status: 'PENDING' }, select: { id: true } });
    await expect(approveRequest(reqRow.id, { orgId: org.orgId, userId: approverWhoSubmitted, roleType: 'ACCOUNTANT' }))
      .rejects.toThrow(/submitted/i);
    await cleanupOrg(org.orgId);
  });

  it('admin self-approval allowed → invoice goes SENT and posts a balanced JE', async () => {
    const org = await createTestOrg();
    await setRequirement(org.orgId, true);
    const admin = await seedUser(org.orgId, 'ADMIN', true);
    const invId = await makeDraftInvoice(org.orgId); // 0-total invoice → JE may be trivial; assert no throw + balanced + status
    await prisma.$transaction((tx) => routeForApproval(tx, { orgId: org.orgId, userId: admin, documentType: 'INVOICE', documentId: invId }));
    const reqRow = await prisma.approvalRequest.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: invId, status: 'PENDING' }, select: { id: true } });
    await approveRequest(reqRow.id, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' });
    const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invId }, select: { status: true } });
    expect(inv.status).toBe('SENT');
    await assertTrialBalanced(org.orgId, 'approved invoice');
    await cleanupOrg(org.orgId);
  });

  it('reject reverts the invoice to DRAFT and posts nothing', async () => {
    const org = await createTestOrg();
    await setRequirement(org.orgId, true);
    const admin = await seedUser(org.orgId, 'ADMIN', true);
    const staff = await seedUser(org.orgId, 'ACCOUNTANT', false);
    const invId = await makeDraftInvoice(org.orgId);
    await prisma.$transaction((tx) => routeForApproval(tx, { orgId: org.orgId, userId: staff, documentType: 'INVOICE', documentId: invId }));
    const reqRow = await prisma.approvalRequest.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: invId, status: 'PENDING' }, select: { id: true } });
    await rejectRequest(reqRow.id, { orgId: org.orgId, userId: admin, roleType: 'ADMIN' }, 'fix the price');
    const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invId }, select: { status: true } });
    expect(inv.status).toBe('DRAFT');
    expect(await journalEntryCount(org.orgId)).toBe(0);
    await cleanupOrg(org.orgId);
  });
});
```

- [ ] **Step 2: Run the integration tests.**

Run: `npm run test:int -- approval-engine`
Expected: all tests PASS. If the 0-total invoice produces no postable JE, adjust `makeDraftInvoice` to add a single non-inventory line with an amount + the Sales/AR accounts from `org.accounts` so `postInvoiceSend` has something to post; keep the assertion `assertTrialBalanced`.

- [ ] **Step 3: Commit.**

```bash
git add lib/__tests__/integration/approval-engine.int.test.ts
git commit -m "test(approval): integration — route/approve/reject, no-GL-until-approved, authz"
```

---

## Task 10: Server config — extend `organization/settings`

**Files:**
- Modify: `src/app/api/v1/organization/settings/route.ts`

- [ ] **Step 1: Include the new fields in GET.** In the GET response object, add normalized approval config:

```typescript
import { normalizeApprovalRequirements } from '@/lib/approval/config';
// ...
return ok({
  ...organization,
  accountDefaults: normalizeAccountDefaults(organization.accountDefaults),
  printSettings: normalizePrintSettings(organization.printSettings),
  approvalRequirements: normalizeApprovalRequirements(organization.approvalRequirements),
  requireDistinctApproverForAdmins: organization.requireDistinctApproverForAdmins ?? false,
  needsInventoryValuationSetup: !organization.costingMethod,
});
```

- [ ] **Step 2: Validate + persist in PUT.** Add to the zod schema (or the manual parse) optional `approvalRequirements` (record of the 10 boolean keys) and `requireDistinctApproverForAdmins` (boolean), admin-gated like the rest of this route. On save:

```typescript
if (parsed.data.approvalRequirements !== undefined) {
  updateData.approvalRequirements = normalizeApprovalRequirements(parsed.data.approvalRequirements);
}
if (parsed.data.requireDistinctApproverForAdmins !== undefined) {
  updateData.requireDistinctApproverForAdmins = !!parsed.data.requireDistinctApproverForAdmins;
}
```

- [ ] **Step 3: Typecheck + commit.**

Run: `npm run typecheck`
Expected: no new errors.

```bash
git add "src/app/api/v1/organization/settings/route.ts"
git commit -m "feat(approval): persist approvalRequirements + admin toggle via org settings API"
```

---

## Task 11: Settings UI — approvals tab reads/writes the server

**Files:**
- Modify: `src/views/settings/Settings.tsx`

- [ ] **Step 1: Source the toggles from the server.** The Accounts/Print tabs already load via the org-settings query and save via `updateOrgSettings.mutateAsync(...)`. Initialize the local `approvalRequirements` state (and a `requireDistinctApproverForAdmins` boolean) from that same query's data instead of the Zustand store.

- [ ] **Step 2: Save to the server.** Change the `if (sectionId === 'approvals')` branch in `saveSection` from `updateApprovalRequirements(...)` to:

```typescript
if (sectionId === 'approvals') {
  await updateOrgSettings.mutateAsync({
    approvalRequirements,
    requireDistinctApproverForAdmins,
  });
}
```

Add a UI control for the **"Require a different approver even for admins"** toggle in the Approval Rules tab (default off), bound to `requireDistinctApproverForAdmins`.

- [ ] **Step 3: Verify in the browser** (preview workflow): open Settings → Approval Rules, toggle "Invoices require approval" + Save; reload; confirm it persists (proves server round-trip). Screenshot for the user.

- [ ] **Step 4: Commit.**

```bash
git add "src/views/settings/Settings.tsx"
git commit -m "feat(approval): Approval Rules tab persists to the server + admin-approver toggle"
```

---

## Task 12: Client RBAC bridge — `canApprove → approve` + `canApproveAny`

**Files:**
- Modify: `src/stores/useAccessStore.ts`
- (Verify only: `src/app/api/v1/auth/me/route.ts` already selects `permissions: true`, so `canApprove` is returned once the column exists.)

- [ ] **Step 1: Carry `approve` through normalization.** In `useAccessStore.ts`, add `approve?: boolean;` to the `ModulePermission` interface. In `normalizeRolePermissions` (~line 224), map the server `canApprove` to `approve` wherever `canView→view` etc. are mapped.

- [ ] **Step 2: Add `canApproveAny`.** Add a store method:

```typescript
canApproveAny: () => {
  const role = get().getCurrentRole();
  if (!role) return false;
  return Object.values(role.permissions).some((p) => p?.approve === true);
},
```

Expose it in the store type. (`hasPermission(moduleKey, 'approve')` works automatically since `approve` is now on the permission object.)

- [ ] **Step 3: Typecheck + commit.**

Run: `npm run typecheck`
Expected: no new errors.

```bash
git add src/stores/useAccessStore.ts
git commit -m "feat(approval): client RBAC carries approve permission + canApproveAny()"
```

---

## Task 13: Dashboard widget — `PendingApprovalsWidget`

**Files:**
- Create: `src/components/dashboard/widgets/PendingApprovalsWidget.tsx`
- Modify: `src/config/dashboardWidgets.ts`
- Modify: `src/views/Dashboard.tsx`

- [ ] **Step 1: Build the widget.** Create `src/components/dashboard/widgets/PendingApprovalsWidget.tsx`:

```typescript
import React from 'react';
import { CheckSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import { useApprovals } from '../../../hooks/useAR';
import { formatIDR } from '../../../utils/formatters';

const PendingApprovalsWidget = (): React.ReactElement => {
  const navigate = useNavigate();
  const { data, isLoading } = useApprovals();
  const items: Array<{ id: string; documentType: string; document?: { number?: string; totalAmount?: number } }> =
    (data?.data as never) ?? [];

  return (
    <Card
      title={
        <div className="flex justify-between items-center">
          <span className="text-sm text-neutral-500 font-normal">Pending Approvals</span>
          <CheckSquare size={24} className="text-primary-500" />
        </div>
      }
      padding
    >
      <div className="text-[2rem] font-bold my-2.5">{isLoading ? '—' : items.length}</div>
      <ul className="text-sm divide-y divide-neutral-100">
        {items.slice(0, 5).map((r) => (
          <li key={r.id} className="py-1.5 flex justify-between gap-2">
            <span className="truncate">{r.documentType === 'INVOICE' ? 'Invoice' : 'PO'} {r.document?.number ?? ''}</span>
            <span className="text-neutral-500">{formatIDR(Number(r.document?.totalAmount ?? 0))}</span>
          </li>
        ))}
        {!isLoading && items.length === 0 && <li className="py-1.5 text-neutral-400">Nothing waiting</li>}
      </ul>
      <button onClick={() => navigate('/ar/approvals')} className="mt-2 text-sm text-primary-600 hover:underline">
        Open Approval Inbox →
      </button>
    </Card>
  );
};

export default PendingApprovalsWidget;
```

- [ ] **Step 2: Register the widget.** In `src/config/dashboardWidgets.ts`, add an entry (with an optional custom gate field) and add `'pending_approvals'` to `DEFAULT_WIDGET_IDS`:

```typescript
export interface WidgetDefinition {
  id: string;
  label: string;
  description: string;
  permission: string;
  size: 'sm' | 'lg';
  requiresApproveRight?: boolean; // gated via canApproveAny() instead of hasPermission
}
// add to WIDGET_REGISTRY:
{ id: 'pending_approvals', label: 'Pending Approvals', description: 'Documents awaiting your approval', permission: 'dashboard', size: 'lg', requiresApproveRight: true },
```

- [ ] **Step 3: Gate + render in Dashboard.** In `src/views/Dashboard.tsx`, register the component in `WIDGET_COMPONENTS` (`pending_approvals: PendingApprovalsWidget`) and extend the filter:

```typescript
const canApproveAny = useAccessStore((s) => s.canApproveAny);
// ...
return saved.filter((id) => {
  const meta = WIDGET_REGISTRY.find((w) => w.id === id);
  if (!meta) return false;
  if (meta.requiresApproveRight) return canApproveAny();
  return hasPermission(meta.permission, 'view');
});
```

(Add `canApproveAny` to the memo dependency array.)

- [ ] **Step 4: Verify in the browser.** As the admin, confirm the widget appears on the dashboard and shows pending items after routing an invoice through approval. Screenshot for the user.

- [ ] **Step 5: Commit.**

```bash
git add src/components/dashboard/widgets/PendingApprovalsWidget.tsx src/config/dashboardWidgets.ts src/views/Dashboard.tsx
git commit -m "feat(approval): Pending Approvals dashboard widget (gated to approvers)"
```

---

## Task 14: Generalize the Approval Inbox

**Files:**
- Modify: `src/views/ar/ApprovalInbox.tsx`

- [ ] **Step 1: Use the generic routes + reason.** Change the approve/reject actions to call `api.post('/api/v1/approvals/${id}/approve')` and `api.post('/api/v1/approvals/${id}/reject', { note })` (prompt for an optional note on reject). Invalidate `['approvals']` on success.

- [ ] **Step 2: Gate the buttons.** Hide/disable Approve & Reject unless `useAccessStore.getState().hasPermission(moduleKeyForType, 'approve')` (map `INVOICE→ar_invoices`, `PURCHASE_ORDER→ap_pos`). Server still enforces — this is UX only.

- [ ] **Step 3: Verify in the browser** (admin): approve one invoice and reject one with a note; confirm the invoice posts (status SENT) on approve and returns to DRAFT on reject. Screenshot for the user.

- [ ] **Step 4: Commit.**

```bash
git add src/views/ar/ApprovalInbox.tsx
git commit -m "feat(approval): inbox uses generic approve/reject routes + reason + button gating"
```

---

## Task 15: Security & Roles — "Approve" column + final pass

**Files:**
- Modify: the Security & Roles permission-matrix component (the view rendering `MODULE_KEYS` with view/create/edit/delete columns)

- [ ] **Step 1: Add the column.** Add an "Approve" checkbox column to the matrix, bound to the role permission's `approve` flag, alongside the existing CRUD columns. **Note in a code comment:** this edits the client role model; persisting it to the server `RolePermission.canApprove` for non-admin roles requires a roles-write API that does not yet exist — flagged as a follow-up. Admins approve out of the box via the seed.

- [ ] **Step 2: Full verification pass.**

Run: `npm run typecheck && npm test && npm run test:int`
Expected: typecheck clean; all unit + integration tests pass.

- [ ] **Step 3: Commit.**

```bash
git add -A
git commit -m "feat(approval): Approve column in role matrix + Phase 1 verification pass"
```

---

## Phase 1 Done — Checkpoint

Stop here and report to the owner with proof (screenshots of the dashboard widget + an approve/reject round-trip, and the passing test output). Ask whether to proceed to **Phase 2** (Bills, Sales Orders, Payroll Runs, Credit/Debit Notes & Returns).

**Deferred / flagged from Phase 1:**
- Non-admin approver configuration from the UI needs a server roles-write API (no API exists today; admins approve via seed).
- Editing a document that has a `PENDING` request should cancel the request and revert to DRAFT (spec error-handling note) — add when wiring edit paths in Phase 2 if not trivially covered.
