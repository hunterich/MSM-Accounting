# Side-nav Restructure + Cash & Bank / Inventory Surfacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the side-nav to mirror Accurate — remove the dead ⌘K search, promote Cash & Bank (Payment/Receive/Transfer/Accounts/Reconciliation) and Inventory (Items/Categories/Adjustments) to first-class groups, split out GL & Reports, and move Stock Valuation under Reports — by surfacing screens that already exist and renaming two forms.

**Architecture:** Almost entirely an information-architecture change in the React frontend. The "Payment/Receive" transactions already work (the existing Expense/Income forms); new clean URLs map to the existing internal action values so the backend is untouched. Stock Valuation reuses its existing standalone view, reached from the Reports hub.

**Tech Stack:** React 19 + React Router 7 + TypeScript + Vite + Tailwind v4. Tests: Vitest (unit). Verification: `npm run typecheck` + browser preview.

**Spec:** `docs/superpowers/specs/2026-06-20-sidenav-cashbank-inventory-design.md`

**Branch:** `feat/sidenav-restructure` (already created; the spec commit lives here).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/views/banking/bankingAction.ts` | **Create** | Pure helper: route→action mapping + action titles (extracted for testability) |
| `src/views/banking/__tests__/bankingAction.test.ts` | **Create** | Unit tests for the route→action mapping |
| `src/views/banking/BankingActionForm.tsx` | Modify | Use the helper; rename Expense→Payment / Income→Receive |
| `src/views/banking/Banking.tsx` | Modify | "New Transaction" dropdown labels + target routes |
| `src/App.tsx` | Modify | Add `/banking/payment` + `/banking/receive` routes |
| `src/components/Layout/Sidebar.tsx` | Modify | New `NAV_GROUPS`, remove search, fix `isItemActive` |
| `src/stores/useAccessStore.ts` | Modify | Map new `/banking/*` paths to the `banking` permission |
| `src/views/reports/Reports.tsx` | Modify | Surface Stock Valuation card under the Inventory category |

---

## Task 1: Extract & extend the route→action mapping (TDD)

**Files:**
- Create: `src/views/banking/bankingAction.ts`
- Test: `src/views/banking/__tests__/bankingAction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/banking/__tests__/bankingAction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getActionFromPath, ACTION_TITLES } from '../bankingAction';

describe('getActionFromPath', () => {
  it('maps the new Accurate-style /banking/payment to the internal "expense" action', () => {
    expect(getActionFromPath('/banking/payment')).toBe('expense');
  });
  it('maps the new /banking/receive to the internal "income" action', () => {
    expect(getActionFromPath('/banking/receive')).toBe('income');
  });
  it('keeps the legacy /banking/expense and /banking/income paths working', () => {
    expect(getActionFromPath('/banking/expense')).toBe('expense');
    expect(getActionFromPath('/banking/income')).toBe('income');
  });
  it('maps transfer and falls back to account', () => {
    expect(getActionFromPath('/banking/transfer')).toBe('transfer');
    expect(getActionFromPath('/banking/account')).toBe('account');
  });
});

describe('ACTION_TITLES', () => {
  it('uses Accurate-style labels for expense/income', () => {
    expect(ACTION_TITLES.expense).toBe('Payment');
    expect(ACTION_TITLES.income).toBe('Receive');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- bankingAction`
Expected: FAIL — cannot resolve `../bankingAction` (module does not exist yet).

- [ ] **Step 3: Create the helper module**

Create `src/views/banking/bankingAction.ts`:

```ts
export type BankingAction = 'transfer' | 'expense' | 'income' | 'account';

/**
 * Maps a banking form route path to its internal action.
 * The new Accurate-style URLs (/banking/payment, /banking/receive) deliberately
 * map onto the EXISTING internal actions (expense, income) so the API contract
 * to /v1/bank-transactions is unchanged.
 */
export const getActionFromPath = (path: string): BankingAction => {
  if (path.includes('transfer')) return 'transfer';
  if (path.includes('payment') || path.includes('expense')) return 'expense';
  if (path.includes('receive') || path.includes('income')) return 'income';
  return 'account';
};

export const ACTION_TITLES: Record<BankingAction, string> = {
  transfer: 'Bank Transfer',
  expense:  'Payment',
  income:   'Receive',
  account:  'Add Bank Account',
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- bankingAction`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/views/banking/bankingAction.ts src/views/banking/__tests__/bankingAction.test.ts
git commit -m "feat(banking): route→action helper mapping payment/receive to expense/income"
```

---

## Task 2: Use the helper in BankingActionForm + rename to Payment/Receive

**Files:**
- Modify: `src/views/banking/BankingActionForm.tsx`

- [ ] **Step 1: Remove the local `getActionFromPath` and `ACTION_TITLES`**

Delete these two blocks (currently at `BankingActionForm.tsx:48-60`):

```ts
const getActionFromPath = (path: string) => {
    if (path.includes('transfer')) return 'transfer';
    if (path.includes('expense'))  return 'expense';
    if (path.includes('income'))   return 'income';
    return 'account';
};

const ACTION_TITLES = {
    transfer: 'Bank Transfer',
    expense:  'Record Expense',
    income:   'Record Income',
    account:  'Add Bank Account',
};
```

- [ ] **Step 2: Import them from the helper instead**

Add to the imports near the top of `BankingActionForm.tsx` (next to the other relative imports):

```ts
import { getActionFromPath, ACTION_TITLES } from './bankingAction';
```

- [ ] **Step 3: Rename the panel titles**

In `BankingActionForm.tsx`, change the Expense panel title (currently `Expense Details`, ~line 460):

```tsx
<span className="invoice-panel-title">Payment Details</span>
```

…and the Income panel title (currently `Income Details`, ~line 555):

```tsx
<span className="invoice-panel-title">Receive Details</span>
```

- [ ] **Step 4: Update the back link label**

Change `backLabel="Back to Banking"` (in the `FormPage` props, ~line 270) to:

```tsx
backLabel="Back to Cash & Bank"
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/banking/BankingActionForm.tsx
git commit -m "refactor(banking): use shared action helper; rename to Payment/Receive"
```

---

## Task 3: Add the `/banking/payment` and `/banking/receive` routes

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the two routes**

In `src/App.tsx`, immediately after the existing `banking/income` route (line 173), add:

```tsx
<Route path="banking/payment" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
<Route path="banking/receive" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
```

(Leave `banking/expense` and `banking/income` in place as working aliases.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify in the browser preview**

With the dev servers running (frontend `npm run dev` on 5173, backend `npm run backend:dev` on 3000), log in (`admin@demo.com` / `admin123`) and navigate to `/banking/payment`.
Expected: the form renders with title **"Payment"** and panel **"Payment Details"**. Navigate to `/banking/receive` → title **"Receive"**, panel **"Receive Details"**.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(banking): add /banking/payment and /banking/receive routes"
```

---

## Task 4: Update the Banking workbench "New Transaction" menu

**Files:**
- Modify: `src/views/banking/Banking.tsx`

- [ ] **Step 1: Relabel and re-route the "New Transaction" menu**

In `src/views/banking/Banking.tsx`, replace the `newTabMenu` array (currently lines 192-196) with:

```tsx
                newTabMenu={[
                    { label: 'Payment', icon: <TrendingDown size={14} />, onSelect: () => navigate('/banking/payment') },
                    { label: 'Receive', icon: <TrendingUp size={14} />, onSelect: () => navigate('/banking/receive') },
                    { label: 'Bank Transfer', icon: <ArrowRightLeft size={14} />, onSelect: () => navigate('/banking/transfer') },
                ]}
```

(`TrendingDown`, `TrendingUp`, `ArrowRightLeft` are already imported in this file.)

- [ ] **Step 2: Update `openTransactionForm` target routes**

In `openTransactionForm` (currently lines 82-95), update `targetPathByType` so editing an existing expense/income transaction opens the renamed routes:

```tsx
        const targetPathByType: Record<string, string> = {
            transfer: '/banking/transfer',
            expense: '/banking/payment',
            income: '/banking/receive'
        };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify in the preview**

Open `/banking`, click **New Transaction**. Expected menu: **Payment · Receive · Bank Transfer**. Clicking Payment opens `/banking/payment` (title "Payment"). On an existing expense row, the edit/Match action opens `/banking/payment` prefilled.

- [ ] **Step 5: Commit**

```bash
git add src/views/banking/Banking.tsx
git commit -m "feat(banking): rename workbench New Transaction menu to Payment/Receive"
```

---

## Task 5: Restructure the side-nav + remove the ⌘K search

**Files:**
- Modify: `src/components/Layout/Sidebar.tsx`

- [ ] **Step 1: Update the icon imports**

In the `lucide-react` import block at the top of `Sidebar.tsx`, **remove** `Search,` and **add** `ArrowRightLeft, ArrowUpRight, ArrowDownLeft, FileText,`. The resulting list must include (in addition to what's already there): `ArrowRightLeft`, `ArrowUpRight`, `ArrowDownLeft`, `FileText`, and must NOT include `Search`.

- [ ] **Step 2: Replace `NAV_GROUPS`**

Replace the entire `NAV_GROUPS` array (currently `Sidebar.tsx:42-97`) with:

```tsx
const NAV_GROUPS: NavGroup[] = [
    {
        group: 'Workspace',
        groupIcon: LayoutDashboard,
        items: [{ label: 'Dashboard', path: '/', icon: LayoutDashboard }],
    },
    {
        group: 'Sales',
        groupIcon: Receipt,
        items: [
            { label: 'Sales Orders',   path: '/ar/sales-orders',   icon: ShoppingBag },
            { label: 'Invoices',       path: '/ar/invoices',       icon: Receipt, badgeKey: 'overdue_invoices' },
            { label: 'Delivery Notes', path: '/ar/delivery-notes', icon: Truck },
            { label: 'Payments',       path: '/ar/payments',       icon: Wallet },
            { label: 'Returns & Credits', path: '/ar/credits',     icon: Receipt },
            { label: 'Recurring Billing', path: '/ar/recurring',   icon: Receipt },
            { label: 'Customers',      path: '/ar/customers',      icon: Users },
            { label: 'Customer Categories', path: '/ar/categories', icon: Users },
            { label: 'Approvals',      path: '/ar/approvals',      icon: CheckSquare, badgeKey: 'pending_approvals' },
            { label: 'Shop Integrations', path: '/integrations',   icon: Building2 },
        ],
    },
    {
        group: 'Purchases',
        groupIcon: ShoppingCart,
        items: [
            { label: 'Purchase Orders', path: '/ap/pos',      icon: ShoppingBag },
            { label: 'Receive Goods',   path: '/ap/receiving', icon: PackageCheck },
            { label: 'Bills',           path: '/ap/bills',    icon: Receipt, badgeKey: 'overdue_bills' },
            { label: 'Payments',        path: '/ap/payments', icon: Wallet },
            { label: 'Returns & Debits',path: '/ap/debits',   icon: Receipt },
            { label: 'Recurring Expenses', path: '/ap/recurring', icon: Receipt },
            { label: 'Vendors',         path: '/ap/vendors',  icon: Building2 },
            { label: 'Vendor Categories', path: '/ap/vendor-categories', icon: Building2 },
        ],
    },
    {
        group: 'Cash & Bank',
        groupIcon: Landmark,
        items: [
            { label: 'Payment',        path: '/banking/payment',        icon: ArrowUpRight },
            { label: 'Receive',        path: '/banking/receive',        icon: ArrowDownLeft },
            { label: 'Bank Transfer',  path: '/banking/transfer',       icon: ArrowRightLeft },
            { label: 'Bank Accounts',  path: '/banking',                icon: Wallet },
            { label: 'Reconciliation', path: '/banking/reconciliation', icon: CheckSquare },
        ],
    },
    {
        group: 'Inventory',
        groupIcon: Package,
        items: [
            { label: 'Items',            path: '/inventory/items',      icon: Package },
            { label: 'Item Categories',  path: '/inventory/categories', icon: Boxes },
            { label: 'Stock Adjustments',path: '/inventory/adjustments',icon: PackageCheck },
        ],
    },
    {
        group: 'General Ledger',
        groupIcon: BookOpen,
        items: [
            { label: 'Chart of Accounts', path: '/gl',          icon: BookOpen },
            { label: 'Journal Entries',   path: '/gl/journals', icon: FileText },
        ],
    },
    {
        group: 'Reports',
        groupIcon: BarChart3,
        items: [
            { label: 'Reports', path: '/reports', icon: BarChart3 },
        ],
    },
    {
        group: 'Operations',
        groupIcon: Boxes,
        items: [
            { label: 'HR & Payroll',  path: '/hr',         icon: Users },
            { label: 'Assets',        path: '/assets',     icon: Building2 },
            { label: 'Settings',      path: '/settings',   icon: Settings },
        ],
    },
];
```

- [ ] **Step 3: Fix `isItemActive` so Bank Accounts highlights exactly**

Replace the `isItemActive` function (currently `Sidebar.tsx:239-244`) with:

```tsx
    const isItemActive = (path: string): boolean => {
        if (path === '/') return location.pathname === '/';
        if (path === '/gl') return location.pathname === '/gl';
        if (path === '/banking') return location.pathname === '/banking';
        if (path === '/inventory') return location.pathname.startsWith('/inventory');
        return location.pathname.startsWith(path);
    };
```

- [ ] **Step 4: Remove the `paletteOpen` state**

Delete this line (currently `Sidebar.tsx:161`):

```tsx
    const [paletteOpen, setPaletteOpen] = useState(false);
```

- [ ] **Step 5: Remove the ⌘K branch from the keydown handler**

In the `useEffect` keydown handler (currently `Sidebar.tsx:177-187`), delete the ⌘K block so only the Escape handler remains:

```tsx
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpenGroup(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
```

- [ ] **Step 6: Remove the search button in the desktop rail**

Delete the entire search `sidebar-icon-wrapper` block in `RailBody` (currently `Sidebar.tsx:257-267`, the `<div className="sidebar-icon-wrapper">` containing the `Search (⌘K)` button and its tooltip).

- [ ] **Step 7: Remove the search button in the full sidebar**

Delete the search container block in `SidebarBody` (currently `Sidebar.tsx:342-352`, the `<div className="px-3 py-2 border-b border-white/10 flex-shrink-0">` wrapping the `Search…` button).

- [ ] **Step 8: Remove the command-palette modal**

Delete the palette modal block at the end of the component (currently `Sidebar.tsx:435-448`, the `{paletteOpen && ( ... )}` JSX).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `Search` is reported unused, confirm it was removed from the import in Step 1.)

- [ ] **Step 10: Verify in the browser preview**

Reload the app. Expected:
- No search box/icon in either the desktop icon rail or (resize narrow) the mobile sidebar; pressing ⌘K does nothing and logs no console error.
- The desktop rail shows group icons for Workspace, Sales, Purchases, **Cash & Bank**, **Inventory**, **General Ledger**, **Reports**, Operations. Hovering **Cash & Bank** opens a flyout with Payment · Receive · Bank Transfer · Bank Accounts · Reconciliation.
- Navigate to `/banking` → only **Bank Accounts** is highlighted (not Payment). Navigate to `/banking/payment` → **Payment** highlighted, Bank Accounts not.

- [ ] **Step 11: Commit**

```bash
git add src/components/Layout/Sidebar.tsx
git commit -m "feat(nav): restructure side-nav (Cash & Bank, Inventory groups); remove ⌘K search"
```

---

## Task 6: Map the new Cash & Bank paths to the `banking` permission

**Files:**
- Modify: `src/stores/useAccessStore.ts`

- [ ] **Step 1: Add the new path→permission entries**

In `src/stores/useAccessStore.ts`, in the `SUBITEM_PERMISSION_MAP` object, next to the existing banking entries (currently lines 163-166: `/banking`, `/banking/transfer`, `/banking/expense`, `/banking/income`), add:

```ts
    '/banking/payment':         'banking',
    '/banking/receive':         'banking',
    '/banking/reconciliation':  'banking',
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify RBAC in the preview**

Log in as the Viewer/Staff demo user (or toggle a role without `banking` view permission in Settings → Security & Roles). Expected: when `banking` view is granted, the full Cash & Bank flyout shows; when revoked, the whole Cash & Bank group disappears (no orphan Payment/Receive items). With it granted, all five items are visible.

- [ ] **Step 4: Commit**

```bash
git add src/stores/useAccessStore.ts
git commit -m "feat(rbac): map /banking/payment, /receive, /reconciliation to banking permission"
```

---

## Task 7: Surface Stock Valuation in the Reports hub

**Files:**
- Modify: `src/views/reports/Reports.tsx`

Approach: add a **card** under the Inventory report category that opens the existing standalone Stock Valuation screen (`/inventory/valuation`). We do NOT rebuild valuation inside the hub's date-based report renderer — Stock Valuation filters by category/warehouse "as of now", which doesn't fit the date-range parameter dialog. The card simply navigates to the working view.

- [ ] **Step 1: Add `'stock-valuation'` to the `ReportType` union**

In `src/views/reports/Reports.tsx`, in the `export type ReportType =` union (starts line 21), add a member alongside `'stock-movement'` (line 42):

```ts
  | 'stock-valuation'
```

- [ ] **Step 2: Add the report definition**

In the `INVENTORY_REPORTS` array (currently `Reports.tsx:750-760`), add a second entry after `stock-movement`:

```ts
  {
    id: 'stock-valuation',
    category: 'inventory',
    apiPath: '/inventory/valuation',
    name: 'Stock Valuation',
    description: 'Current inventory value (qty × average cost) per item, filterable by category and warehouse.',
    type: 'table',
    filterMode: 'as-of',
  },
```

- [ ] **Step 3: Import `useNavigate`**

At the top of `Reports.tsx`, add the React Router import (the file does not currently import it):

```ts
import { useNavigate } from 'react-router-dom';
```

Then, inside the main `Reports` component function body (next to the other `useState`/hook calls, e.g. near `const [activeReportId, ...]` at line 1142), add:

```ts
  const navigate = useNavigate();
```

- [ ] **Step 4: Intercept the card click for Stock Valuation**

Replace the `handleCardClick` function (currently `Reports.tsx:1277-1280`) with:

```ts
  const handleCardClick = (report: ReportDefinition) => {
    // Stock Valuation reuses its standalone view (category/warehouse filters,
    // not the date-based param dialog), so navigate instead of opening the modal.
    if (report.id === 'stock-valuation') {
      navigate('/inventory/valuation');
      return;
    }
    const presetParams = activeReport?.report.id === report.id ? activeReport.params : null;
    openParamModal(report, presetParams);
  };
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Verify in the preview**

Open `/reports`, select the **Inventory** category in the left rail. Expected: two cards — **Stock Movement** and **Stock Valuation**. Click **Stock Valuation** → routes to the existing Stock Valuation screen (item table with Qty on Hand, Avg Unit Cost, Total Value, and a Total Inventory Value footer). Confirm Stock Valuation no longer appears anywhere in the Inventory side-nav group (verified in Task 5).

- [ ] **Step 7: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): surface Stock Valuation card under the Inventory category"
```

---

## Task 8: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npm test`
Expected: all tests pass, including the new `bankingAction` suite.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Full preview walkthrough**

With both dev servers up and logged in, confirm end-to-end:
1. No search anywhere in the nav; ⌘K is inert.
2. All 8 nav groups present and correctly ordered (desktop rail flyouts + mobile sidebar).
3. **Cash & Bank → Payment** saves a transaction (pick a bank account + an expense account + amount → Save) and returns to Banking with the new row present.
4. **Cash & Bank → Receive** saves similarly against a revenue account.
5. **Inventory → Items / Item Categories / Stock Adjustments** each open their screens; create a category and create an adjustment succeed.
6. **General Ledger → Journal Entries** opens `/gl/journals`.
7. **Reports → Inventory → Stock Valuation** opens the valuation screen.
8. Bank Accounts highlights only on `/banking`.

- [ ] **Step 4: Confirm the branch state**

Run: `git log --oneline -10`
Expected: the spec commit plus the per-task commits, all on `feat/sidenav-restructure`. The pre-existing unrelated working-tree changes (package.json, stock-adjustments route, etc.) remain unstaged and untouched.

---

## Notes for the implementer

- **Do not modify the backend.** `/v1/bank-transactions` still receives action `expense`/`income`; only the URLs and labels change.
- **Deferred (do not build here):** Warehouse management UI, inter-warehouse Stock Transfer, PPN/e-Faktur, command-palette implementation.
- If `npm run dev` / preview is slow, check `.claude/worktrees` for stale `node_modules` (see project memory) before debugging.
