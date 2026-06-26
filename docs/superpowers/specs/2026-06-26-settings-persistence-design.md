# Settings consolidation + server persistence (PR A)

**Date:** 2026-06-26
**Branch base:** `main` (follows the merged Settings reorg, PR #70)
**Status:** Design — awaiting review

## Context

The Operations → Settings area was reorganized in PR #70 (grouped tabs, URL
routing, data tools moved to `/tools`). Two problems remain:

1. **Duplicated controls.** Tax appears in *Company Info* and is mirrored as a
   toggle in *Features*. Credit settings are split: defaults (limit/terms) in
   *Customers & Sales*, the enforce toggle in *Restrictions*.
2. **Inconsistent persistence.** Several settings groups are written only to a
   client-side Zustand store (`msm-settings`, localStorage) and never reach the
   database, so they don't follow a user across devices/browsers:
   features, document numbering, tax, credit, sales policy. Notifications aren't
   persisted at all (the form validates but never saves).

Meanwhile, the backend is further along than expected: the `Organization` table
**already has columns** and the `PUT /api/v1/organization/settings` route
**already accepts** Tax, Credit (limit + enforce), and Notifications. The
frontend simply doesn't use them for those tabs.

## Goal

Make every configuration setting on the Settings page persist to the database
via the existing org-settings API (server = source of truth; Zustand kept only
as a first-paint cache), and remove the duplicated controls so each setting has
exactly one home.

## Decisions (resolved during brainstorming)

- **Tax home:** stays in *Company Info*. Remove only the mirror toggle from
  *Features*.
- **Credit home:** all credit controls (limit, terms, **enforce**) consolidate
  under *Customers & Sales*. *Restrictions* keeps only the sales policies.
- **Storage style:** JSON columns for `features`, `documentNumbering`,
  `salesPolicy` (matches the existing `accountDefaults` / `approvalRequirements`
  / `printSettings` convention); a typed `Int` column for `defaultPaymentTerms`
  (matches `defaultCreditLimit` being a typed `Decimal`).
- **Source of truth:** DB. Zustand stores remain as a first-paint cache,
  hydrated from the server on load (mirrors how Company Info already works).
- **Out of scope (separate PR B):** Security & Roles page move + DB-backed RBAC.

## Scope

### In scope
- De-dup Tax (drop Features mirror) and Credit (move enforce into Customers &
  Sales; Restrictions = sales policies only).
- Persist to the org-settings API: tax, credit (limit/terms/enforce),
  notifications, features, document numbering, sales policy.
- One additive Prisma migration for the four new columns.
- Hydrate all affected form state from the server on load.

### Out of scope
- Security & Roles / RBAC (PR B).
- Print settings bank/terbilang fields (a pre-existing normalizer gap, untouched
  here).
- Any change to the four data tools or the `/tools` page.

## Architecture

### 1. Database (Prisma) — additive migration

Add to `model Organization` in `prisma/schema.prisma`:

| Column | Type | Purpose |
|---|---|---|
| `defaultPaymentTerms` | `Int @default(0)` | credit terms (days) |
| `features` | `Json?` | feature flags (booleans) |
| `documentNumbering` | `Json?` | per-doc numbering config |
| `salesPolicy` | `Json?` | `{ blockSellBelowCost, requireSalesOrder }` |

All nullable/defaulted → existing rows backfill to defaults via the route
normalizers; no data migration needed. Apply with `prisma migrate dev`
locally; **prod needs the migration at deploy** (consistent with the project's
other pending schema items).

### 2. Zod input schema — `types/api.ts`

Extend `updateOrganizationSettingsInputSchema` with:
- `defaultPaymentTerms: z.number().int().min(0).optional()`
- `features: z.record(z.string(), z.boolean()).optional()`
- `documentNumbering: z.record(z.string(), z.object({ prefix: z.string(),
  resetPeriod: z.enum(['monthly','yearly','never']), seqLength: z.number().int()
  }).partial()).optional()`
- `salesPolicy: z.object({ blockSellBelowCost: z.boolean(),
  requireSalesOrder: z.boolean() }).partial().optional()`

(Tax, credit limit/enforce, and notification fields are already present.)

### 3. API route — `src/app/api/v1/organization/settings/route.ts`

Follow the existing `accountDefaults` / `printSettings` pattern:
- Add `normalizeFeatures`, `normalizeDocumentNumbering`, `normalizeSalesPolicy`
  helpers with a known-keys whitelist + per-field type guards and defaults.
- In `GET`, return the normalized values for the three JSON columns +
  `defaultPaymentTerms`.
- In `PUT`, when each field is present, normalize-merge over existing and assign
  to `updateData` (numbering/features merge per-key like `accountDefaults`).
  `defaultPaymentTerms` is a plain scalar assignment.
- Tax, credit limit/enforce, and notification scalars are already wired
  through; add `defaultPaymentTerms` (new scalar) plus the three JSON
  normalizers. The audit-log payload already captures `updateData`.

### 4. Frontend hook — `src/hooks/useOrganizationSettings.ts`

- Ensure the GET response surfaces `features`, `documentNumbering`,
  `salesPolicy`, `defaultPaymentTerms` (plus the already-present tax/credit/
  notification scalars) in the normalized shape the components consume.
- Reuse the existing `useUpdateOrganizationSettings()` mutation for all saves.

### 5. Settings page — `src/views/settings/Settings.tsx`

Rewire each tab's `saveSection` to send its fields through
`updateOrgSettings.mutateAsync(...)` (then mirror into Zustand for instant
paint), and hydrate form state from `serverOrgSettings` on load:

| Tab | Change |
|---|---|
| Company Info (`general`) | Add `taxEnabled/taxDefaultRate/taxInclusiveByDefault` to the existing mutate payload. |
| Customers & Sales (`customers`) | Add the **enforce** toggle here; send `defaultCreditLimit`, `defaultPaymentTerms`, `enforceCreditLimit`. |
| Restrictions (`restrictions`) | Remove the credit-enforce control + the cross-reference note; send `salesPolicy`. |
| Features (`features`) | Remove the Tax mirror row; send `features`. |
| Document Numbering (`numbering`) | Send `documentNumbering` (already has a local draft + Save button from PR #70). |
| Notifications (`notifications`) | Actually save: send `financeEmail/invoiceReminders/paymentAlerts/dailySummary`. |

Extend the existing server-hydration `useEffect`s so tax, credit (incl. terms),
sales policy, features, numbering, and notification form state seed from
`serverOrgSettings` when it loads (same pattern already used for account
defaults and approvals).

## Data flow

- **Load:** `GET /organization/settings` → hook normalizes → hydration effects
  seed each tab's form state (and the Zustand cache) → first paint may briefly
  use the Zustand cache, then server overwrites.
- **Save:** tab's Save button → `mutateAsync` PUT with that tab's fields →
  server normalizes/merges/persists → response mirrored into Zustand → React
  Query invalidates `organization/settings`.

## Error handling

- Each save wraps `mutateAsync` in try/catch and surfaces a `window.alert`
  message on failure (matches the existing general/print/accounts/approvals
  handlers). On error, local Zustand is **not** updated, so the cache never
  drifts from the server.
- Server normalizers drop unknown/invalid fields rather than 400-ing, except
  where existing validation already applies (e.g. notification email required
  when a reminder toggle is on).

## Testing

- **Unit (vitest):** normalizer functions (`normalizeFeatures`,
  `normalizeDocumentNumbering`, `normalizeSalesPolicy`) — valid input passes,
  unknown keys dropped, missing fields fall back to defaults.
- **Integration (`test:int`, real Postgres):** PUT then GET round-trips each new
  field; partial updates merge rather than clobber; defaults returned for an org
  with NULL columns.
- **Manual (preview):** each tab saves, reload shows persisted values; tax no
  longer appears in Features; credit enforce no longer in Restrictions.
- Full `tsc`, `vite build`, and existing unit suite stay green.

## Migration / rollout notes

- Single additive migration; safe to deploy before the frontend (new columns
  just sit unused).
- Local dev: run the migration + (if needed) reseed.
- Prod: run the migration at deploy.
- No breaking change to existing API consumers — all new request fields are
  optional; all new response fields are additive.
