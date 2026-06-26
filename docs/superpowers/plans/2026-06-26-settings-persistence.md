# Settings Consolidation + Server Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Settings configuration group persist to the database via the existing org-settings API, and remove the duplicated Tax/Credit controls so each setting has one home.

**Architecture:** The `Organization` table already has columns + the `PUT /api/v1/organization/settings` route already accepts Tax, Credit (limit/enforce), and Notifications — so those are frontend-rewire only. Four new columns (`defaultPaymentTerms`, `features`, `documentNumbering`, `salesPolicy`) get an additive migration, backend normalizers (mirroring `lib/approval/config.ts`), zod validation, and frontend wiring. Server = source of truth; Zustand stays as a first-paint cache hydrated from the server.

**Tech Stack:** Next.js route handlers, Prisma (Postgres), Zod, React + React Query + Zustand, Vitest (unit + `test:int` integration).

**Spec:** `docs/superpowers/specs/2026-06-26-settings-persistence-design.md`

---

### Task 1: Add the four columns to the Organization model

**Files:**
- Modify: `prisma/schema.prisma` (model `Organization`, near the existing `accountDefaults`/`printSettings` Json fields, ~lines 40-43)

- [ ] **Step 1: Add the columns**

In `model Organization`, immediately after `printSettings Json?` (line 43), add:

```prisma
  defaultPaymentTerms              Int      @default(0)
  features                         Json?
  documentNumbering                Json?
  salesPolicy                      Json?
```

- [ ] **Step 2: Create + apply the migration**

Run: `npm run prisma:migrate:dev -- --name add_org_settings_columns`
Expected: a new folder under `prisma/migrations/` and `Organization` gains the columns. (If the dev DB is unreachable, fall back to `npm run prisma:generate && npx prisma db push`.)

- [ ] **Step 3: Regenerate the client**

Run: `npm run prisma:generate`
Expected: success (this repo shares a cross-worktree Prisma client; regenerate before typecheck).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add features/documentNumbering/salesPolicy/defaultPaymentTerms to Organization"
```

---

### Task 2: Backend settings-config module (normalizers) — TDD

Mirror the existing `lib/approval/config.ts` (defaults + a `normalize*` guard). Pure functions, no Prisma — unit-testable.

**Files:**
- Create: `lib/organization/settings-config.ts`
- Test: `lib/organization/__tests__/settings-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/organization/__tests__/settings-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeFeatures, DEFAULT_FEATURES,
  normalizeDocumentNumbering, DEFAULT_DOCUMENT_NUMBERING,
  normalizeSalesPolicy, DEFAULT_SALES_POLICY,
} from '../settings-config';

describe('normalizeFeatures', () => {
  it('returns all defaults for non-object input', () => {
    expect(normalizeFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(normalizeFeatures('nope')).toEqual(DEFAULT_FEATURES);
  });
  it('overrides only known boolean keys and ignores junk', () => {
    const out = normalizeFeatures({ salesOrders: false, bogus: true, hrPayroll: 'x' });
    expect(out.salesOrders).toBe(false);
    expect(out.hrPayroll).toBe(true); // junk value ignored -> default
    expect('bogus' in out).toBe(false);
  });
});

describe('normalizeSalesPolicy', () => {
  it('defaults when missing', () => {
    expect(normalizeSalesPolicy(undefined)).toEqual(DEFAULT_SALES_POLICY);
  });
  it('keeps known booleans only', () => {
    const out = normalizeSalesPolicy({ blockSellBelowCost: true, requireSalesOrder: 'y', x: 1 });
    expect(out).toEqual({ blockSellBelowCost: true, requireSalesOrder: false });
  });
});

describe('normalizeDocumentNumbering', () => {
  it('fills defaults for all six doc types', () => {
    const out = normalizeDocumentNumbering(null);
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_DOCUMENT_NUMBERING).sort());
    expect(out.ar_invoice).toEqual(DEFAULT_DOCUMENT_NUMBERING.ar_invoice);
  });
  it('merges per-doc fields and coerces types', () => {
    const out = normalizeDocumentNumbering({ ar_invoice: { prefix: 'FAK', seqLength: 8 }, junk: { prefix: 'X' } });
    expect(out.ar_invoice).toEqual({ prefix: 'FAK', resetPeriod: 'monthly', seqLength: 8 });
    expect('junk' in out).toBe(false);
    expect(out.ap_bill).toEqual(DEFAULT_DOCUMENT_NUMBERING.ap_bill);
  });
  it('rejects invalid resetPeriod and seqLength', () => {
    const out = normalizeDocumentNumbering({ so_order: { resetPeriod: 'daily', seqLength: 99 } });
    expect(out.so_order.resetPeriod).toBe('monthly'); // invalid -> default
    expect(out.so_order.seqLength).toBe(6);            // not in {4,5,6,8} -> default
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- settings-config`
Expected: FAIL ("Cannot find module '../settings-config'").

- [ ] **Step 3: Implement the module**

Create `lib/organization/settings-config.ts`:

```ts
// Canonical backend defaults + normalizers for the org-settings JSON columns.
// Mirrors lib/approval/config.ts. Shapes match src/stores/useSettingsStore.ts
// (the codebase intentionally keeps a small copy per layer, like the approval
// defaults).

export const FEATURE_KEYS = [
  'salesOrders', 'salesReturns', 'recurringInvoices', 'subscriptions',
  'recurringExpenses', 'deliveryNotes', 'customerCategories', 'approvals',
  'shopIntegrations', 'purchaseOrders', 'vendorCategories', 'itemCategories',
  'fixedAssets', 'hrPayroll',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

export const DEFAULT_FEATURES: Features = FEATURE_KEYS.reduce(
  (acc, k) => { acc[k] = true; return acc; }, {} as Features,
);

export function normalizeFeatures(raw: unknown): Features {
  const out: Features = { ...DEFAULT_FEATURES };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of FEATURE_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

export interface SalesPolicy { blockSellBelowCost: boolean; requireSalesOrder: boolean; }
export const DEFAULT_SALES_POLICY: SalesPolicy = { blockSellBelowCost: false, requireSalesOrder: false };

export function normalizeSalesPolicy(raw: unknown): SalesPolicy {
  const out: SalesPolicy = { ...DEFAULT_SALES_POLICY };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.blockSellBelowCost === 'boolean') out.blockSellBelowCost = o.blockSellBelowCost;
    if (typeof o.requireSalesOrder === 'boolean') out.requireSalesOrder = o.requireSalesOrder;
  }
  return out;
}

export interface DocNumberingConfig { prefix: string; resetPeriod: string; seqLength: number; }
export const DOC_NUMBERING_KEYS = ['ar_invoice', 'ap_bill', 'so_order', 'po_order', 'ar_payment', 'ap_payment'] as const;
export type DocNumberingKey = (typeof DOC_NUMBERING_KEYS)[number];

export const DEFAULT_DOCUMENT_NUMBERING: Record<DocNumberingKey, DocNumberingConfig> = {
  ar_invoice: { prefix: 'INV',  resetPeriod: 'monthly', seqLength: 6 },
  ap_bill:    { prefix: 'BILL', resetPeriod: 'monthly', seqLength: 6 },
  so_order:   { prefix: 'SO',   resetPeriod: 'monthly', seqLength: 6 },
  po_order:   { prefix: 'PO',   resetPeriod: 'monthly', seqLength: 6 },
  ar_payment: { prefix: 'PAY',  resetPeriod: 'never',   seqLength: 6 },
  ap_payment: { prefix: 'VPAY', resetPeriod: 'never',   seqLength: 6 },
};

const RESET_PERIODS = new Set(['monthly', 'yearly', 'never']);
const SEQ_LENGTHS = new Set([4, 5, 6, 8]);

export function normalizeDocumentNumbering(raw: unknown): Record<DocNumberingKey, DocNumberingConfig> {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<DocNumberingKey, DocNumberingConfig>;
  for (const key of DOC_NUMBERING_KEYS) {
    const def = DEFAULT_DOCUMENT_NUMBERING[key];
    const incoming = (src[key] && typeof src[key] === 'object') ? (src[key] as Record<string, unknown>) : {};
    out[key] = {
      prefix: typeof incoming.prefix === 'string' && incoming.prefix.length > 0
        ? incoming.prefix.toUpperCase() : def.prefix,
      resetPeriod: RESET_PERIODS.has(String(incoming.resetPeriod)) ? String(incoming.resetPeriod) : def.resetPeriod,
      seqLength: SEQ_LENGTHS.has(Number(incoming.seqLength)) ? Number(incoming.seqLength) : def.seqLength,
    };
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- settings-config`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/organization/settings-config.ts lib/organization/__tests__/settings-config.test.ts
git commit -m "feat(org-settings): add normalizers for features/numbering/salesPolicy"
```

---

### Task 3: Extend the zod input schema

**Files:**
- Modify: `types/api.ts` (`updateOrganizationSettingsInputSchema`, after the `printSettings` block, before the closing `});`)

- [ ] **Step 1: Add the new optional fields**

Inside `updateOrganizationSettingsInputSchema = z.object({ ... })`, after the `printSettings: z.object({...}).optional(),` entry, add:

```ts
  defaultPaymentTerms: z.number().int().min(0).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  salesPolicy: z.object({
    blockSellBelowCost: z.boolean().optional(),
    requireSalesOrder: z.boolean().optional(),
  }).optional(),
  documentNumbering: z.record(
    z.string(),
    z.object({
      prefix: z.string().max(12).optional(),
      resetPeriod: z.enum(['monthly', 'yearly', 'never']).optional(),
      seqLength: z.number().int().optional(),
    }),
  ).optional(),
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0 (no type errors introduced).

- [ ] **Step 3: Commit**

```bash
git add types/api.ts
git commit -m "feat(org-settings): accept features/numbering/salesPolicy/paymentTerms in input schema"
```

---

### Task 4: Wire the new fields into the GET + PUT route

**Files:**
- Modify: `src/app/api/v1/organization/settings/route.ts`

- [ ] **Step 1: Import the normalizers**

After the existing `import { normalizeApprovalRequirements } from '@/lib/approval/config';` (line 13), add:

```ts
import {
  normalizeFeatures,
  normalizeDocumentNumbering,
  normalizeSalesPolicy,
} from '@/lib/organization/settings-config';
```

- [ ] **Step 2: Extend the record type**

In `type OrganizationSettingsRecord`, add these fields (after `requireDistinctApproverForAdmins: boolean;`):

```ts
  defaultPaymentTerms: number;
  features: unknown;
  documentNumbering: unknown;
  salesPolicy: unknown;
```

- [ ] **Step 3: Normalize in the GET response**

In `GET`, extend the returned object (after `requireDistinctApproverForAdmins: ...`):

```ts
    defaultPaymentTerms: organization.defaultPaymentTerms ?? 0,
    features: normalizeFeatures(organization.features),
    documentNumbering: normalizeDocumentNumbering(organization.documentNumbering),
    salesPolicy: normalizeSalesPolicy(organization.salesPolicy),
```

- [ ] **Step 4: Persist in the PUT handler**

In `PUT`, after the `requireDistinctApproverForAdmins` block (~line 234), add:

```ts
  if (parsed.data.defaultPaymentTerms !== undefined) {
    updateData.defaultPaymentTerms = parsed.data.defaultPaymentTerms;
  }
  if (parsed.data.features !== undefined) {
    updateData.features = normalizeFeatures(parsed.data.features);
  }
  if (parsed.data.salesPolicy !== undefined) {
    updateData.salesPolicy = normalizeSalesPolicy(parsed.data.salesPolicy);
  }
  if (parsed.data.documentNumbering !== undefined) {
    const existing = normalizeDocumentNumbering(
      ((await prisma.organization.findUnique({
        where: { id: orgId },
        select: { documentNumbering: true },
      })) as unknown as { documentNumbering: unknown } | null)?.documentNumbering,
    );
    // Merge incoming per-doc edits over existing, then normalize.
    const merged: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(parsed.data.documentNumbering)) {
      merged[k] = { ...(existing as Record<string, unknown>)[k] as object, ...(v as object) };
    }
    updateData.documentNumbering = normalizeDocumentNumbering(merged);
  }
```

- [ ] **Step 5: Normalize in the PUT response**

In the `PUT` final `ok({...})` block, add the same four lines as Step 3 (using `updated` instead of `organization`):

```ts
    defaultPaymentTerms: updated.defaultPaymentTerms ?? 0,
    features: normalizeFeatures(updated.features),
    documentNumbering: normalizeDocumentNumbering(updated.documentNumbering),
    salesPolicy: normalizeSalesPolicy(updated.salesPolicy),
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1/organization/settings/route.ts
git commit -m "feat(org-settings): persist features/numbering/salesPolicy/paymentTerms via route"
```

---

### Task 5: Integration test — round-trip the new columns

Confirms the migration applied and the columns persist/normalize. Mirrors the existing `lib/__tests__/integration/*.int.test.ts` style (direct Prisma, real Postgres).

**Files:**
- Create: `lib/__tests__/integration/org-settings-persistence.int.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { normalizeFeatures, normalizeDocumentNumbering, normalizeSalesPolicy } from '@/lib/organization/settings-config';

describe('org settings new columns persist', () => {
  let orgId: string;
  beforeAll(async () => {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (!org) throw new Error('seed an organization for the test DB first');
    orgId = org.id;
  });

  it('writes and reads back features/documentNumbering/salesPolicy/defaultPaymentTerms', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        defaultPaymentTerms: 30,
        features: { salesOrders: false },
        salesPolicy: { blockSellBelowCost: true, requireSalesOrder: false },
        documentNumbering: { ar_invoice: { prefix: 'FAK', resetPeriod: 'yearly', seqLength: 8 } },
      } as never,
    });

    const row = await prisma.organization.findUnique({ where: { id: orgId } }) as unknown as {
      defaultPaymentTerms: number; features: unknown; salesPolicy: unknown; documentNumbering: unknown;
    };

    expect(row.defaultPaymentTerms).toBe(30);
    expect(normalizeFeatures(row.features).salesOrders).toBe(false);
    expect(normalizeFeatures(row.features).hrPayroll).toBe(true); // default preserved
    expect(normalizeSalesPolicy(row.salesPolicy)).toEqual({ blockSellBelowCost: true, requireSalesOrder: false });
    expect(normalizeDocumentNumbering(row.documentNumbering).ar_invoice).toEqual({ prefix: 'FAK', resetPeriod: 'yearly', seqLength: 8 });
  });
});
```

- [ ] **Step 2: Run the integration suite**

Run: `npm run test:int -- org-settings-persistence`
Expected: PASS. (If the test DB isn't provisioned, run `npm run test:int:setup` first.)

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/integration/org-settings-persistence.int.test.ts
git commit -m "test(int): round-trip new org-settings columns"
```

---

### Task 6: Frontend types — expose the new fields

**Files:**
- Modify: `src/types/index.ts` (`RawOrganizationSettings` ~line 295, `OrganizationSettings` ~line 441)

- [ ] **Step 1: Add fields to both interfaces**

In `RawOrganizationSettings`, alongside the existing optional scalar fields, add:

```ts
  defaultCreditLimit?: number | null;
  defaultPaymentTerms?: number | null;
  enforceCreditLimit?: boolean | null;
  taxEnabled?: boolean | null;
  taxDefaultRate?: number | null;
  taxInclusiveByDefault?: boolean | null;
  financeEmail?: string | null;
  invoiceReminders?: boolean | null;
  paymentAlerts?: boolean | null;
  dailySummary?: boolean | null;
  features?: Record<string, boolean> | null;
  documentNumbering?: Record<string, { prefix?: string; resetPeriod?: string; seqLength?: number }> | null;
  salesPolicy?: { blockSellBelowCost?: boolean; requireSalesOrder?: boolean } | null;
```

(Only add the ones not already present — check the interface first; several scalars may already exist.)

In `OrganizationSettings` (the normalized shape), add:

```ts
  defaultCreditLimit: number;
  defaultPaymentTerms: number;
  enforceCreditLimit: boolean;
  taxEnabled: boolean;
  taxDefaultRate: number;
  taxInclusiveByDefault: boolean;
  financeEmail: string;
  invoiceReminders: boolean;
  paymentAlerts: boolean;
  dailySummary: boolean;
  features: Record<string, boolean>;
  documentNumbering: Record<string, { prefix: string; resetPeriod: string; seqLength: number }>;
  salesPolicy: { blockSellBelowCost: boolean; requireSalesOrder: boolean };
```

- [ ] **Step 2: Typecheck (expect errors in the hook next)**

Run: `npx tsc --noEmit`
Expected: errors only in `useOrganizationSettings.ts` (normalizer doesn't yet set the new fields) — fixed in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add settings fields to Raw/OrganizationSettings"
```

---

### Task 7: Hook — normalize the new fields from the server

**Files:**
- Modify: `src/hooks/useOrganizationSettings.ts` (`normalizeOrganizationSettings`, ~lines 23-61)

- [ ] **Step 1: Import the backend defaults/normalizers**

Add at the top (these are shared lib modules, already imported elsewhere from `../../lib/...`):

```ts
import { normalizeFeatures, normalizeDocumentNumbering, normalizeSalesPolicy } from '../../lib/organization/settings-config';
```

- [ ] **Step 2: Extend the returned object**

In `normalizeOrganizationSettings`, add to the returned object (after `requireDistinctApproverForAdmins`):

```ts
    defaultCreditLimit: Number(raw.defaultCreditLimit ?? 0),
    defaultPaymentTerms: Number(raw.defaultPaymentTerms ?? 0),
    enforceCreditLimit: raw.enforceCreditLimit !== false,
    taxEnabled: raw.taxEnabled !== false,
    taxDefaultRate: Number(raw.taxDefaultRate ?? 11),
    taxInclusiveByDefault: raw.taxInclusiveByDefault === true,
    financeEmail: raw.financeEmail || '',
    invoiceReminders: raw.invoiceReminders !== false,
    paymentAlerts: raw.paymentAlerts !== false,
    dailySummary: raw.dailySummary === true,
    features: normalizeFeatures(raw.features),
    documentNumbering: normalizeDocumentNumbering(raw.documentNumbering),
    salesPolicy: normalizeSalesPolicy(raw.salesPolicy),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOrganizationSettings.ts
git commit -m "feat(org-settings): surface settings fields from the hook"
```

---

### Task 8: Settings page — hydrate from server, save to API, de-dup

**Files:**
- Modify: `src/views/settings/Settings.tsx`

This task rewires save paths and removes the duplicated controls. Do it in one task because the changes interlock.

- [ ] **Step 1: Add server hydration effects**

After the existing `serverOrgSettings` hydration `useEffect` (the approvals one, ~line 144-148), add effects seeding the other tabs' form state from the server. `serverOrgSettings` is the normalized object from `useOrganizationSettings()` (already destructured as `serverOrgSettings`):

```tsx
    // Seed tax, credit, sales policy, features, numbering, notifications from the
    // server (DB is source of truth). Zustand stays a first-paint cache.
    useEffect(() => {
      if (!serverOrgSettings) return;
      const s = serverOrgSettings;
      setTaxData({ enabled: s.taxEnabled, defaultRate: s.taxDefaultRate, inclusiveByDefault: s.taxInclusiveByDefault });
      setCreditLimitSettings({
        defaultLimit: String(s.defaultCreditLimit),
        defaultPaymentTerms: String(s.defaultPaymentTerms),
        enforceLimit: s.enforceCreditLimit,
      });
      setSalesPolicy(s.salesPolicy);
      setFeatures((prev) => ({ ...prev, ...s.features }));
      setNumberingForm((prev) => ({ ...prev, ...s.documentNumbering }));
      setNotificationSettings({
        financeEmail: s.financeEmail || '',
        invoiceReminders: s.invoiceReminders,
        paymentAlerts: s.paymentAlerts,
        dailySummary: s.dailySummary,
      });
    }, [serverOrgSettings]);
```

- [ ] **Step 2: Send tax with Company Info save**

In `saveSection`, the `general` branch already calls `updateOrgSettings.mutateAsync({...company fields})`. Add the tax fields to that payload object:

```tsx
                    taxEnabled: taxData.enabled,
                    taxDefaultRate: taxData.defaultRate,
                    taxInclusiveByDefault: taxData.inclusiveByDefault,
```

(Keep the existing `updateTaxSettings(taxData)` mirror line.)

- [ ] **Step 2b: Make `general` save numeric tax rate safe**

Before the mutate call in `general`, guard the rate:

```tsx
            if (taxData.enabled && (isNaN(Number(taxData.defaultRate)) || Number(taxData.defaultRate) < 0 || Number(taxData.defaultRate) > 100)) {
                window.alert('Tax rate must be between 0 and 100.');
                return;
            }
```

- [ ] **Step 3: Persist credit (limit + terms + enforce) in the `customers` branch**

Replace the `customers` branch body (currently `if (!saveCustomerCreditSettings()) return;`) with:

```tsx
        if (sectionId === 'customers') {
            const defaultLimit = Number(creditLimitSettings.defaultLimit);
            const defaultPaymentTerms = Number(creditLimitSettings.defaultPaymentTerms);
            if (isNaN(defaultLimit) || defaultLimit < 0) { window.alert('Default credit limit must be a non-negative number.'); return; }
            if (isNaN(defaultPaymentTerms) || defaultPaymentTerms < 0) { window.alert('Default credit terms must be a non-negative number of days.'); return; }
            try {
                await updateOrgSettings.mutateAsync({
                    defaultCreditLimit: defaultLimit,
                    defaultPaymentTerms,
                    enforceCreditLimit: creditLimitSettings.enforceLimit,
                } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save credit settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateCustomerCreditSettings({ defaultLimit, defaultPaymentTerms, enforceLimit: creditLimitSettings.enforceLimit });
        }
```

- [ ] **Step 4: Persist sales policy in the `restrictions` branch**

Replace the `restrictions` branch (currently calls `saveCustomerCreditSettings()` + `updateSalesPolicy`) with:

```tsx
        if (sectionId === 'restrictions') {
            try {
                await updateOrgSettings.mutateAsync({ salesPolicy } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save sales policies: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateSalesPolicy(salesPolicy);
        }
```

- [ ] **Step 5: Persist features in the `features` branch**

Replace the `features` branch with:

```tsx
        if (sectionId === 'features') {
            try {
                await updateOrgSettings.mutateAsync({ features } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save features: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateFeatures(features);
        }
```

- [ ] **Step 6: Persist numbering in the `numbering` branch**

Replace the `numbering` branch (the local-draft commit from PR #70) with:

```tsx
        if (sectionId === 'numbering') {
            try {
                await updateOrgSettings.mutateAsync({ documentNumbering: numberingForm } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save document numbering: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            Object.entries(numberingForm).forEach(([k, v]) => updateDocumentNumbering(k, v));
        }
```

- [ ] **Step 7: Persist notifications in the `notifications` branch**

Replace the `notifications` branch (currently validates only) with:

```tsx
        if (sectionId === 'notifications') {
            const requiresEmail = notificationSettings.invoiceReminders || notificationSettings.paymentAlerts || notificationSettings.dailySummary;
            if (requiresEmail && !notificationSettings.financeEmail.includes('@')) { window.alert('Enter a valid finance notification email.'); return; }
            try {
                await updateOrgSettings.mutateAsync({
                    financeEmail: notificationSettings.financeEmail,
                    invoiceReminders: notificationSettings.invoiceReminders,
                    paymentAlerts: notificationSettings.paymentAlerts,
                    dailySummary: notificationSettings.dailySummary,
                } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save notifications: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
        }
```

- [ ] **Step 8: De-dup — remove the Tax mirror from Features**

In the `features` tab JSX, delete the `<FeatureRow label="Tax (PPN)" ... />` row (the one with `hint="Mirrors Company Info → Tax Settings."`).

- [ ] **Step 9: De-dup — move the enforce toggle into Customers & Sales**

In the `customers` tab JSX, after the Master Credit Terms field and before the save button, add the enforce checkbox (moved from Restrictions):

```tsx
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={creditLimitSettings.enforceLimit}
                                    onChange={(e) => setCreditLimitSettings({ ...creditLimitSettings, enforceLimit: e.target.checked })}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Enforce credit limit on invoices</span>
                            </label>
                        </div>
```

Also delete the "Looking for the credit-limit and sales-policy rules? They live under Restrictions now." help-text block in this tab.

- [ ] **Step 10: De-dup — drop the credit section from Restrictions**

In the `restrictions` tab JSX, delete the "Customer & Credit" `<h3>` heading and its enforce-limit checkbox block (now in Customers & Sales). Keep only the "Sales Policies" section.

- [ ] **Step 11: Remove the now-unused `saveCustomerCreditSettings` helper**

Delete the `saveCustomerCreditSettings` function (no longer called after Steps 3-4).

- [ ] **Step 12: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 13: Commit**

```bash
git add src/views/settings/Settings.tsx
git commit -m "feat(settings): persist all tabs to org API; de-dup tax & credit controls"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit + integration + typecheck + build**

Run: `npx tsc --noEmit && npm test && npm run test:int -- org-settings-persistence && npm run build`
Expected: all green.

- [ ] **Step 2: Manual preview pass**

Start the dev server (`preview_start` "dev" on 5173, backend on 3000), log in (demo `admin@demo.com` / `admin123`), then for each tab: change a value → Save → reload the page → confirm the value persisted (proves DB, not localStorage). Specifically check:
- Company Info: toggle tax rate, save, reload → persists.
- Customers & Sales: set credit limit + terms + enforce, save, reload → persists; the enforce toggle is here.
- Restrictions: only sales policies remain; toggle one, save, reload → persists.
- Features: the Tax row is gone; toggle a module, save, reload → persists.
- Document Numbering: change a prefix, Save, reload → persists.
- Notifications: change email + a toggle, save, reload → persists.

- [ ] **Step 3: Console + network check**

Confirm no console errors and that each Save issues a `PUT /api/v1/organization/settings` returning 200.

---

## Notes for the implementer

- This repo shares a Prisma client across worktrees — run `npm run prisma:generate` before typecheck if you see stale Prisma types.
- The org-settings PUT is gated by `withPermission({ module: 'SETTINGS', action: 'edit' })`; the demo admin passes.
- Deploy: the migration must run on prod (and any other dev DB) — additive, no backfill needed.
- `subscriptions` exists in `FeatureFlags` but isn't shown in the Features tab UI; the `features` JSON still round-trips it harmlessly.
