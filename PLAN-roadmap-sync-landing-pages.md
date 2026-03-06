# Execution Plan: Roadmap Sync + Module Landing Pages

> Generated 2026-03-02 | Execute in order: Phase 1 → Phase 3

---

## Phase 1: Roadmap Synchronization

### File: `ROADMAP.md`

Apply these edits in-place:

#### 1. Technical Debt table (line 297)

Change:
```
| Virtual scrolling / lazy-load for large lists (Accurate pattern) | Not started | **Critical** |
```
To:
```
| Virtual scrolling / lazy-load for large lists (Accurate pattern) | [~] Table.jsx supports @tanstack/react-virtual (auto >50 rows), record count footer on all list pages | **Critical** |
```

#### 2. Catalog / List View Pattern (lines 329–336)

Replace entire section with:
```markdown
### Catalog / List View Pattern
- [x] **Virtual scrolling** — `Table.jsx` supports `@tanstack/react-virtual`, auto-activates when data > 50 rows, per-row `<table>` layout with `colgroup` sync
- [ ] **Lazy-load on scroll** — fetch next batch from server as user scrolls near bottom (requires backend)
- [~] **Total record count** — implemented as table footer count bar (`RecordCount.jsx`) on all 13 list pages; not positioned next to search bar like Accurate
- [~] **Sticky column headers** — achieved in virtualized table mode (split header table + scrollable body); not uniformly sticky in non-virtualized mode
- [ ] **Server-side filtering** — date range, customer, status dropdowns filter via API (requires backend)
- [ ] **Server-side search** — search queries sent to backend (requires backend)
- [ ] **Skeleton rows** — show placeholder rows while next batch loads
- [~] Adopt for all catalogs — shared `Table` component applies to 13 pages; `InvoiceCatalogPanel` uses custom table (not yet migrated)
```

#### 3. Tabbed Document Workspace (lines 338–344)

Replace entire section with:
```markdown
### Tabbed Document Workspace
- [x] **Tab bar** at top for open documents (like browser tabs)
- [x] Multiple invoices/documents open simultaneously as tabs
- [x] "Data Baru" (New) tab always available for quick creation
- [x] Tab close button (x) to dismiss individual documents
- [x] Tab count indicator
- [~] Pattern implemented across 6 pages (InvoiceWorkbench, AR Payments, AP Payments, CreditNotes, DebitNotes, Customers) but NOT standardized into shared components — each page re-implements tab logic independently
- [ ] Extract shared `useDocumentTabs` hook and `DocumentTabBar` component to eliminate duplication
```

#### 4. Access Control module groups (line 319)

Change:
```
- [x] Module groups: Dashboard, General Ledger, AR, AP, Inventory, Banking, Integrations, Reports, Company, Settings
```
To:
```
- [x] Module groups: Dashboard, General Ledger, AR, AP, Inventory, Banking, HR & Payroll, Integrations, Reports, Company, Settings
```

#### 5. HR & Payroll — Phase 3.2 (lines 136–153)

Replace entire section with:
```markdown
### 3.2 HR & Payroll (Employee Master Data & Payroll Run)
- [~] **Employee Master Data:**
  - [x] Personal info (Name, KTP, DOB, Contact, Address)
  - [x] Employment details (Join Date, Department, Job Title, Employment Status)
  - [x] Bank details (Bank Name, Account Number, Account Holder)
  - [x] Government IDs (NPWP, BPJS Kesehatan, BPJS Ketenagakerjaan)
  - [x] Salary Structure (Basic Salary, Default Allowances, Default Deductions)
- [ ] **Attendance & Leave Management:** (placeholder page at /hr/attendance)
  - [ ] Time tracking / Daily attendance (manual entry or import)
  - [ ] Leave types (Annual, Sick, Unpaid)
  - [ ] Leave balance management
- [ ] **Payroll Processing & Generation:** (placeholder page at /hr/payroll-run)
  - [ ] Monthly batch run (generate payslips for all active employees)
  - [ ] Variable component entry (Overtime, Bonuses, Penalties per run)
  - [ ] PPh 21 Tax calculation (TER integration)
  - [ ] BPJS calculations (Employer vs Employee portions)
  - [ ] Salary slip PDF generation
- [ ] **Accounting Integration:**
  - [ ] Auto-post Payroll Summary Journal Entry upon approval (Debit Salary Expense, Credit Bank/Taxes Payable)
```

#### 6. Feature Comparison table (line 378)

Change:
```
| HR & Payroll | No | Yes | High |
```
To:
```
| HR & Payroll | Partial (Employee master data) | Yes | High |
```

---

## Phase 3: Module Landing Pages (Grid Tiles)

### Overview

Create tile-based landing pages for module roots so clicking a sidebar module icon shows a grid of sub-feature tiles instead of redirecting to the first sub-page. Follow Accurate Online's pattern.

### Step 1: Create shared UI components

#### `src/components/UI/ModuleLandingPage.jsx` (NEW)

```jsx
import React from 'react';

const ModuleLandingPage = ({ title, description, children }) => {
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold text-neutral-900 mb-1">{title}</h1>
            {description && <p className="text-neutral-500 mb-6">{description}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {children}
            </div>
        </div>
    );
};

export default ModuleLandingPage;
```

#### `src/components/UI/ModuleTile.jsx` (NEW)

```jsx
import React from 'react';
import { Link } from 'react-router-dom';

const toneStyles = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
    pink: 'bg-pink-50 border-pink-200 text-pink-700 hover:bg-pink-100',
    purple: 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100',
    amber: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100',
    slate: 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100',
};

const ModuleTile = ({ icon: Icon, label, description, to, tone = 'blue' }) => {
    const style = toneStyles[tone] || toneStyles.blue;

    return (
        <Link
            to={to}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border p-6 transition-colors ${style}`}
        >
            {Icon && <Icon size={32} strokeWidth={1.5} />}
            <span className="text-sm font-semibold text-center">{label}</span>
            {description && <span className="text-xs text-center opacity-70">{description}</span>}
        </Link>
    );
};

export default ModuleTile;
```

### Step 2: Create landing page components

#### `src/pages/ar/ARLanding.jsx` (NEW)

```jsx
import React from 'react';
import ModuleLandingPage from '../../components/UI/ModuleLandingPage';
import ModuleTile from '../../components/UI/ModuleTile';
import { FileText, CreditCard, RotateCcw, Users } from 'lucide-react';
import { useAccessStore } from '../../stores/useAccessStore';

const tiles = [
    { icon: FileText, label: 'Invoices', to: '/ar/invoices', tone: 'blue' },
    { icon: CreditCard, label: 'Payments', to: '/ar/payments', tone: 'green' },
    { icon: RotateCcw, label: 'Credit Notes & Returns', to: '/ar/credits', tone: 'pink' },
    { icon: Users, label: 'Customers', to: '/ar/customers', tone: 'purple' },
];

const ARLanding = () => {
    const canSeeSubItem = useAccessStore(s => s.canSeeSubItem);
    const visibleTiles = tiles.filter(t => canSeeSubItem(t.to));

    if (visibleTiles.length === 0) {
        return (
            <div className="p-6">
                <h1 className="text-2xl font-bold text-neutral-900 mb-1">Accounts Receivable</h1>
                <p className="text-neutral-500 mt-4">You don't have access to any AR features. Contact your administrator.</p>
            </div>
        );
    }

    return (
        <ModuleLandingPage title="Accounts Receivable" description="Manage invoices, payments, and customer relationships.">
            {visibleTiles.map(t => (
                <ModuleTile key={t.to} icon={t.icon} label={t.label} to={t.to} tone={t.tone} />
            ))}
        </ModuleLandingPage>
    );
};

export default ARLanding;
```

#### `src/pages/ap/APLanding.jsx` (NEW)

```jsx
import React from 'react';
import ModuleLandingPage from '../../components/UI/ModuleLandingPage';
import ModuleTile from '../../components/UI/ModuleTile';
import { FileText, ShoppingCart, CreditCard, RotateCcw, Building2 } from 'lucide-react';
import { useAccessStore } from '../../stores/useAccessStore';

const tiles = [
    { icon: FileText, label: 'Bills', to: '/ap/bills', tone: 'blue' },
    { icon: ShoppingCart, label: 'Purchase Orders', to: '/ap/pos', tone: 'green' },
    { icon: CreditCard, label: 'Payments', to: '/ap/payments', tone: 'amber' },
    { icon: RotateCcw, label: 'Debit Notes & Returns', to: '/ap/debits', tone: 'pink' },
    { icon: Building2, label: 'Vendors', to: '/ap/vendors', tone: 'purple' },
];

const APLanding = () => {
    const canSeeSubItem = useAccessStore(s => s.canSeeSubItem);
    const visibleTiles = tiles.filter(t => canSeeSubItem(t.to));

    if (visibleTiles.length === 0) {
        return (
            <div className="p-6">
                <h1 className="text-2xl font-bold text-neutral-900 mb-1">Accounts Payable</h1>
                <p className="text-neutral-500 mt-4">You don't have access to any AP features. Contact your administrator.</p>
            </div>
        );
    }

    return (
        <ModuleLandingPage title="Accounts Payable" description="Manage bills, purchase orders, and vendor relationships.">
            {visibleTiles.map(t => (
                <ModuleTile key={t.to} icon={t.icon} label={t.label} to={t.to} tone={t.tone} />
            ))}
        </ModuleLandingPage>
    );
};

export default APLanding;
```

#### `src/pages/hr/HRLanding.jsx` (NEW)

```jsx
import React from 'react';
import ModuleLandingPage from '../../components/UI/ModuleLandingPage';
import ModuleTile from '../../components/UI/ModuleTile';
import { Users, CalendarCheck, Banknote } from 'lucide-react';
import { useAccessStore } from '../../stores/useAccessStore';

const tiles = [
    { icon: Users, label: 'Employees', to: '/hr/employees', tone: 'blue' },
    { icon: CalendarCheck, label: 'Attendance & Leave', to: '/hr/attendance', tone: 'green' },
    { icon: Banknote, label: 'Payroll Run', to: '/hr/payroll-run', tone: 'amber' },
];

const HRLanding = () => {
    const canSeeSubItem = useAccessStore(s => s.canSeeSubItem);
    const visibleTiles = tiles.filter(t => canSeeSubItem(t.to));

    if (visibleTiles.length === 0) {
        return (
            <div className="p-6">
                <h1 className="text-2xl font-bold text-neutral-900 mb-1">HR & Payroll</h1>
                <p className="text-neutral-500 mt-4">You don't have access to any HR features. Contact your administrator.</p>
            </div>
        );
    }

    return (
        <ModuleLandingPage title="HR & Payroll" description="Manage employees, attendance, and payroll processing.">
            {visibleTiles.map(t => (
                <ModuleTile key={t.to} icon={t.icon} label={t.label} to={t.to} tone={t.tone} />
            ))}
        </ModuleLandingPage>
    );
};

export default HRLanding;
```

#### `src/pages/inventory/InventoryLanding.jsx` (NEW)

```jsx
import React from 'react';
import ModuleLandingPage from '../../components/UI/ModuleLandingPage';
import ModuleTile from '../../components/UI/ModuleTile';
import { Package, ClipboardList } from 'lucide-react';
import { useAccessStore } from '../../stores/useAccessStore';

const tiles = [
    { icon: Package, label: 'Items', to: '/inventory/items', tone: 'blue' },
    { icon: ClipboardList, label: 'Adjustments', to: '/inventory/adjustments', tone: 'green' },
];

const InventoryLanding = () => {
    const canSeeSubItem = useAccessStore(s => s.canSeeSubItem);
    const visibleTiles = tiles.filter(t => canSeeSubItem(t.to));

    if (visibleTiles.length === 0) {
        return (
            <div className="p-6">
                <h1 className="text-2xl font-bold text-neutral-900 mb-1">Inventory</h1>
                <p className="text-neutral-500 mt-4">You don't have access to any inventory features. Contact your administrator.</p>
            </div>
        );
    }

    return (
        <ModuleLandingPage title="Inventory" description="Manage items and stock adjustments.">
            {visibleTiles.map(t => (
                <ModuleTile key={t.to} icon={t.icon} label={t.label} to={t.to} tone={t.tone} />
            ))}
        </ModuleLandingPage>
    );
};

export default InventoryLanding;
```

### Step 3: Update routing in `src/App.jsx`

#### Add imports (top of file):
```jsx
import ARLanding from './pages/ar/ARLanding';
import APLanding from './pages/ap/APLanding';
import HRLanding from './pages/hr/HRLanding';
import InventoryLanding from './pages/inventory/InventoryLanding';
```

#### Change routes:

**AR module root** — Replace:
```jsx
<Route path="ar" element={<Navigate to="/ar/invoices" replace />} />
```
With:
```jsx
<Route path="ar" element={<ARLanding />} />
```

**AP module root** — Replace:
```jsx
<Route path="ap" element={<Navigate to="/ap/bills" replace />} />
```
With:
```jsx
<Route path="ap" element={<APLanding />} />
```

**HR module root** — Replace:
```jsx
<Route path="hr" element={<Navigate to="/hr/employees" replace />} />
```
With:
```jsx
<Route path="hr" element={<HRLanding />} />
```

**Inventory module root** — Replace:
```jsx
<Route path="inventory" element={<Inventory />} />
```
With:
```jsx
<Route path="inventory" element={<InventoryLanding />} />
<Route path="inventory/items" element={<Inventory />} />
```

**Note**: Add the new `inventory/items` route. The existing `Inventory` component moves from `/inventory` to `/inventory/items`.

#### Banking — NO CHANGE
`/banking` already renders a dashboard-style hub (`Banking.jsx`). No landing page needed.

### Step 4: Update sidebar sub-item links

Check `src/components/Layout/Sidebar.jsx` — the Inventory flyout sub-item for "Items" currently points to `/inventory`. Update it to `/inventory/items`.

Find the sidebar nav item for Inventory and update the `items` sub-link path from `/inventory` to `/inventory/items`.

### Step 5: Update `SUBITEM_PERMISSION_MAP` in `src/stores/useAccessStore.js`

Since `/inventory` is now the landing page (not the item list), add a new entry for `/inventory/items`:

In the `SUBITEM_PERMISSION_MAP` object, add:
```javascript
'/inventory/items': 'inv_items',
```

Keep the existing entries:
- `'/inventory'` → `'inv_items'` (keep — landing page inherits item-level check)
- `'/inventory/adjustments'` → `'inv_adj'` (keep — unchanged)

**Why this works**: Landing pages use `canSeeSubItem(tile.to)` which looks up the tile's `to` path in `SUBITEM_PERMISSION_MAP`. Since tile paths match existing map entries (`/ar/invoices`, `/ap/bills`, `/hr/employees`, `/inventory/adjustments`), no other changes needed. Only `/inventory/items` is a NEW path that needs a new map entry.

**Note on RBAC key names**: Landing pages no longer reference MODULE_KEYS directly — they use `canSeeSubItem(path)` which resolves keys internally via `SUBITEM_PERMISSION_MAP`. The correct keys are:
- AR: `ar_invoices`, `ar_payments`, `ar_credits`, `ar_customers`
- AP: `ap_bills`, `ap_pos`, `ap_payments`, `ap_debits`, `ap_vendors`
- HR: `hr_employees`, `hr_attendance`, `hr_payroll`
- Inventory: `inv_items`, `inv_adj`

---

## Phase 2: Tabbed Workspace Standardization — DEFERRED

**Not in scope for this execution.** This is a large refactoring across 6 working pages (InvoiceWorkbench, AR Payments, AP Payments, CreditNotes, DebitNotes, Customers). The approach would be:

1. Extract `useDocumentTabs(config)` hook — shared tab state logic (open, close, select, fallback)
2. Extract `<DocumentTabBar>` component — shared tab bar UI with wrapping rows
3. Migrate one page at a time, testing after each

Do this in a dedicated session when there's time for thorough regression testing.

---

## Verification Checklist

### Phase 1 (Roadmap)
- [ ] Read ROADMAP.md — all checkboxes match current code reality
- [ ] HR section shows `[~]` with implemented sub-bullets marked `[x]`
- [ ] Virtual scrolling marked `[x]`, record count marked `[~]`
- [ ] Tabbed workspace items marked `[x]` with standardization note
- [ ] Feature comparison table updated for HR

### Phase 3 (Landing Pages)
- [ ] Navigate to `/ar` → shows 4 tiles (Invoices, Payments, Credit Notes, Customers)
- [ ] Click each tile → navigates to correct sub-page
- [ ] Navigate to `/ap` → shows 5 tiles (Bills, PO, Payments, Debit Notes, Vendors)
- [ ] Navigate to `/hr` → shows 3 tiles (Employees, Attendance, Payroll)
- [ ] Navigate to `/inventory` → shows 2 tiles (Items, Adjustments)
- [ ] Navigate to `/banking` → still shows banking dashboard (unchanged)
- [ ] Click Inventory "Items" tile → goes to item list (was at `/inventory`, now at `/inventory/items`)
- [ ] Switch to Staff User (no HR permissions) → `/hr` shows "no access" empty state
- [ ] All existing deep links work: `/ar/invoices`, `/ap/bills`, `/hr/employees`, `/inventory/adjustments`
- [ ] Sidebar flyout links still navigate directly to sub-pages
- [ ] Sidebar Inventory → Items flyout link updated to `/inventory/items`
- [ ] `SUBITEM_PERMISSION_MAP` in `useAccessStore.js` has `/inventory/items` → `inv_items` entry
- [ ] No console errors on any page
