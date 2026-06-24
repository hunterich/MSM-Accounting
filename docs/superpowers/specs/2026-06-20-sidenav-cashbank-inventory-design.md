# Side-nav restructure + Cash & Bank / Inventory surfacing

**Date:** 2026-06-20
**Status:** Approved (pending spec review)
**Scope:** Information architecture + renaming. No backend, GL posting, or new transaction logic.

## Goal

Make the side-nav mirror Accurate's module tree so existing-but-hidden screens become discoverable, and so non-product money movement has first-class entry points. This is the first slice of a broader "be a faithful Accurate clone" effort (see `memory/project_north_star.md`). The broader "product-focused comprehensiveness" review is explicitly **out of scope** here.

Two driving observations from the user:
1. The ⌘K search in the side-nav is dead weight (it's an unwired stub).
2. Accurate separates **subledger payments** (against invoices/bills) from **direct cash transactions** (operating expense/income with no vendor/customer document). The latter — Accurate's *Kas & Bank → Pembayaran / Penerimaan* — has no first-class entry point today.

## Key finding: almost everything already exists

This is mostly a surfacing/renaming change, not new feature work.

- **Cash & Bank direct transactions already work.** `src/views/banking/BankingActionForm.tsx` already implements "Record Expense" (Paid From → Expense Account picker; for maintenance, subscriptions, stationery) and "Record Income" (Deposit To → Revenue Account picker; for bank interest, other income). These post correctly via `useCreateBankTransaction` with action `expense`/`income`. They are only reachable through a dropdown on the Banking page.
- **Inventory screens already exist** but are hidden behind a single `/inventory` nav item: Items (`/inventory/items`, `/inventory/new`), Item Categories (`/inventory/categories`), Stock Adjustments (`/inventory/adjustments` + `/new` + `/edit`), Stock Valuation (`/inventory/valuation`). Routes confirmed in `src/App.tsx:159-167`.
- **Journal Entries** exists at `/gl/journals` but was never linked in the nav (only `/gl`, the Chart of Accounts, was).

Genuinely missing (and **deferred** — user runs a single location): Warehouse management UI and inter-warehouse Stock Transfer.

## Design

### 1. Remove the ⌘K search

Delete the search affordance entirely from `src/components/Layout/Sidebar.tsx`:
- The search button in the desktop icon rail (`RailBody`).
- The search button block in the full sidebar (`SidebarBody`).
- The `paletteOpen` state and the command-palette modal JSX.
- The ⌘K branch of the `keydown` handler. **Keep** the `Escape` branch (used to close the rail flyout).

### 2. New `NAV_GROUPS` structure

Replaces the array at `src/components/Layout/Sidebar.tsx:42`.

| Group | Items → route | Notes |
|---|---|---|
| Workspace | Dashboard → `/` | unchanged |
| Sales | *(unchanged)* | |
| Purchases | *(unchanged)* | |
| **Cash & Bank** | Payment → `/banking/payment` · Receive → `/banking/receive` · Bank Transfer → `/banking/transfer` · Bank Accounts → `/banking` · Reconciliation → `/banking/reconciliation` | new group |
| **Inventory** | Items → `/inventory/items` · Item Categories → `/inventory/categories` · Stock Adjustments → `/inventory/adjustments` | promoted from single item |
| **General Ledger** | Chart of Accounts → `/gl` · Journal Entries → `/gl/journals` | Journal Entries newly linked |
| **Reports** | Reports → `/reports` | Stock Valuation surfaced inside the hub (see §5) |
| Operations | HR & Payroll → `/hr` · Assets → `/assets` · Settings → `/settings` | Inventory removed from this group |

Icons (lucide, already imported or trivial additions): Cash & Bank group `Landmark`; Payment `TrendingDown`/`ArrowUpRight`, Receive `TrendingUp`/`ArrowDownLeft`, Bank Transfer `ArrowRightLeft`, Bank Accounts `Wallet`, Reconciliation `CheckSquare`. Inventory group `Package`; Items `Package`, Item Categories `Boxes`, Stock Adjustments `PackageCheck`. GL group `BookOpen`; Chart of Accounts `BookOpen`, Journal Entries `FileText`. Reports `BarChart3`.

### 3. Payment / Receive = existing forms, renamed

No new form logic. In `src/views/banking/BankingActionForm.tsx`:
- `ACTION_TITLES`: `expense → "Payment"`, `income → "Receive"`. Panel titles "Expense Details" → "Payment Details", "Income Details" → "Receive Details". (Field labels like "Paid From", "Expense Account", "Deposit To", "Revenue Account" stay — they are accurate.)
- `getActionFromPath`: map the new URLs to the **existing internal action values** so the backend is untouched:
  - path contains `payment` **or** `expense` → action `expense`
  - path contains `receive` **or** `income` → action `income`
  - `transfer` / `account` unchanged.
- In `src/views/banking/Banking.tsx`: the "New Transaction" dropdown labels become **Payment / Receive / Bank Transfer**; `openTransactionForm`'s `targetPathByType` maps `expense → /banking/payment`, `income → /banking/receive`, `transfer → /banking/transfer`.

### 4. Routes

In `src/App.tsx`, add `/banking/payment` and `/banking/receive` pointing at `BankingActionForm` (same component; behavior selected by `getActionFromPath`). The legacy `/banking/expense` and `/banking/income` routes may be kept as aliases or removed; if kept, they still resolve correctly. **Backend (`/v1/bank-transactions`) is unchanged** because the transmitted `action` is still `expense`/`income`.

### 5. Stock Valuation moves into Reports

Stock Valuation is a read-only report (Accurate files it under *Laporan Persediaan*), so it does **not** belong in the Inventory operations group.
- Remove it from the Inventory nav group (done in §2 — it's absent there).
- Surface it inside the Reports hub (`src/views/reports/Reports.tsx`) under the existing `inventory` report category, alongside Stock Movement.
- **Reuse the existing `StockValuation` view / `useStockValuation` hook — do not rebuild the valuation logic.** The exact integration mechanism (render the existing component inside the hub vs. add it to the hub's inline report renderer) is an implementation detail for the plan. The `/inventory/valuation` route may be retained (linked from the hub) or redirected into the hub; either is acceptable as long as Stock Valuation is reached from Reports, not Inventory.

### 6. Plumbing (so items show and highlight correctly)

The permission store is `src/stores/useAccessStore.ts`. Its `SUBITEM_PERMISSION_MAP` **already** maps the paths we need for Inventory (`/inventory/items → inv_items`, `/inventory/categories → inv_categories`, `/inventory/adjustments → inv_adj`), GL (`/gl/journals → gl_journal`), and most Cash & Bank paths (`/banking → banking`, `/banking/transfer → banking`). `SIDEBAR_PERMISSION_MAP` already has the `'Banking'`, `'Inventory'`, `'General Ledger'` groups. So the only RBAC additions are the **new** routes:
- `SUBITEM_PERMISSION_MAP` (in `useAccessStore.ts`): add `/banking/payment → banking`, `/banking/receive → banking`, `/banking/reconciliation → banking`. (`/banking/expense` and `/banking/income` already exist; keep or drop with the route decision in §4.)

Because every nav path then resolves directly in `SUBITEM_PERMISSION_MAP`, the local `PARENT_LABEL_FOR` fallback in `Sidebar.tsx` (used only when a path is *absent* from that map) needs no new entries for visibility. Updating it is optional cleanup, not required.

Other plumbing:
- **Feature flags.** Keep the existing `SUBITEM_FEATURE_MAP` entry `/inventory/categories → itemCategories` in `Sidebar.tsx`. No new flags.
- **Active-state matching.** Fix `isItemActive` in `Sidebar.tsx` so **Bank Accounts (`/banking`)** matches *exactly* (`pathname === '/banking'`), otherwise it stays highlighted on `/banking/payment` etc. — the same special-case already applied to `/gl`.
- **Mobile + desktop parity.** Both `RailBody` and `SidebarBody` render from `NAV_GROUPS`, so the restructure updates both automatically. The rail flyout already treats single-item groups (Workspace, Reports) as a direct `NavLink` — no change needed.

## Out of scope / deferred

- Warehouse management UI and inter-warehouse Stock Transfer (single location — YAGNI).
- The broader "product-focused vs generic" sales/comprehensiveness review.
- PPN / e-Faktur and other tax-layer gaps (tracked separately).
- Command-palette implementation (the ⌘K stub is being removed, not finished).

## Acceptance criteria

1. No search control anywhere in the side-nav (desktop rail or mobile); ⌘K does nothing; no console errors from the removed handler/modal.
2. Side-nav shows the eight groups in §2 with the listed items, on both desktop rail (flyout) and mobile.
3. **Cash & Bank → Payment** opens the (renamed) expense form at `/banking/payment`; **Receive** opens the income form at `/banking/receive`; saving each posts a bank transaction exactly as before (verify a GL/bank effect is produced).
4. **Inventory → Items / Item Categories / Stock Adjustments** open their existing screens; creating a category and creating an adjustment still work.
5. **General Ledger → Journal Entries** opens `/gl/journals`.
6. **Bank Accounts** highlights only on `/banking`, not on its child routes.
7. **Stock Valuation** is reachable from the Reports section and no longer appears under Inventory.
8. RBAC: a user without a given permission (e.g. `inv_adj`) does not see that item; a Viewer still sees what they could see before.
