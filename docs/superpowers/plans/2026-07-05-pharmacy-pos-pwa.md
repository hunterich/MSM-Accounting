# Pharmacy POS — Cashier App (online) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an online cashier web app as a second Vite entry (`pos.html` → `src/pos/`) inside the MSM monorepo that drives the Slice-1 `/api/v1/pos/*` endpoints: login, open/close shift, barcode/search checkout, cash tender + change, and a printed HTML receipt.

**Architecture:** A kiosk-isolated React SPA sharing the repo's TanStack Query client, `api` fetch helper, `useAuthStore` (same `msm_token` cookie), and Tailwind theme. Pure display math is reused from the server's `lib/pos/pricing.ts` + `lib/pos/tender.ts` (DRY). Server is authoritative for posted totals; the client computes totals only for live display. No offline/service-worker in this slice.

**Tech Stack:** React 19, Vite (multi-entry), Tailwind v4, TanStack Query, Zustand, TypeScript, Vitest (pure-logic unit tests), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-05-pharmacy-pos-pwa-checkout-design.md`
**Branch:** `pharmacy-pos-pwa` (off `main`, which has the merged Slice-1 backend).

---

## Conventions this plan relies on (verified in the codebase)

- Shared API client: `import { api } from '@/src/api/apiClient'` → `api.get<T>(path, params?)`, `api.post<T>(path, body?)`. Sends `credentials:'include'`; returns the **unwrapped** JSON (server uses `ok()` with no envelope); throws `Error(body.error)` on non-2xx.
- Auth store (reuse): `import { useAuthStore } from '@/src/stores/useAuthStore'` — `login(email,password)`, `logout()`, `checkSession()`, and state `{ user, org, isLoading }`. Login endpoint `/api/v1/auth/login`, session `/api/v1/auth/me` (returns `{ user, org, ... }`), logout `/api/v1/auth/logout`.
- Query client (reuse): `import { queryClient } from '@/src/lib/queryClient'`.
- Shared UI: `import Button from '@/src/components/UI/Button'` (props: `text|children`, `variant`, `size`, `onClick`, `disabled`, `loading`, `type`), `Input` (`label`, `value`, `onChange`, `type`, `error`), `Modal` (`isOpen`, `onClose`, `title`, `size`). Icons: `lucide-react`.
- Reused pure server logic: `import { computeSaleTotals } from '@/lib/pos/pricing'` (`(lines, taxRatePct) => { subtotal, taxAmount, totalAmount }`, tax-inclusive) and `import { validateCashTender } from '@/lib/pos/tender'` (`(total, cash) => { ok, change, reason? }`).
- Slice-1 POS endpoints: `GET /api/v1/pos/registers`, `POST /api/v1/pos/shifts`, `POST /api/v1/pos/shifts/[id]/close`, `GET /api/v1/pos/catalog`, `POST /api/v1/pos/sales`.
- Unit tests: `npm test` (vitest; pure logic only — RTL is NOT installed). Typecheck: `npm run typecheck`. Build: `npm run build` (builds all Vite entries). E2E: `npm run test:e2e` (Playwright, `testDir ./e2e`, baseURL `http://localhost:5173`, **no webServer** — start `npm run dev` + `npm run backend:dev` first; hits the dev DB).
- Global CSS: both entries import `src/index.css` (Tailwind v4 tokens).

**Seeded cashier for manual/e2e runs:** the Slice-1 seed adds a `POS Operator` role, `WALK-IN` customer, and `REG-1` register. Running e2e needs the **dev DB** seeded (`npm run db:seed`) + a stocked batch-tracked item + both servers running. Unit + typecheck + build are the CI-runnable gates; the e2e spec is a committed deliverable runnable manually.

---

## File Structure

```
pos.html                              NEW — POS entry (root)
vite.config.js                        MODIFY — build.rollupOptions.input { main, pos }
src/pos/
├── main.tsx                          mounts <PosApp/> + QueryClientProvider + '../index.css'
├── PosApp.tsx                        view switch (auth → shift → checkout)
├── i18n/strings.ts                   { id, en } dict + t(key, locale)
├── state/cart.ts                     pure cart model + ops (totals via computeSaleTotals)
├── hooks/usePos.ts                   useCatalog, useRegisters, useOpenShift, useCloseShift, usePostSale
├── views/
│   ├── LoginView.tsx
│   ├── ShiftOpenView.tsx
│   ├── ShiftCloseView.tsx
│   ├── CheckoutView.tsx
│   └── ReceiptView.tsx
├── components/
│   ├── ScanBox.tsx
│   ├── CartLines.tsx
│   └── CashTenderModal.tsx
└── styles/print.css                  @media print — 58/80mm receipt
e2e/pos-checkout.spec.ts              NEW — Playwright happy path
```

---

## Task 1: Vite multi-entry + POS scaffold

**Files:**
- Modify: `vite.config.js`
- Create: `pos.html`, `src/pos/main.tsx`, `src/pos/PosApp.tsx`

- [ ] **Step 1: Add the second entry to `vite.config.js`**

Add a `build` block (keep everything else). Insert after the `server` block:

```js
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
                pos: path.resolve(__dirname, 'pos.html'),
            },
        },
    },
```

- [ ] **Step 2: Create `pos.html` at the repo root**

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pharmacy POS</title>
  </head>
  <body>
    <div id="pos-root"></div>
    <script type="module" src="/src/pos/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/pos/PosApp.tsx` (placeholder for now)**

```tsx
import React from 'react';

export default function PosApp(): React.ReactElement {
  return <div className="p-8 text-2xl font-semibold">Pharmacy POS</div>;
}
```

- [ ] **Step 4: Create `src/pos/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import PosApp from './PosApp';
import { queryClient } from '../lib/queryClient';
import '../index.css';

ReactDOM.createRoot(document.getElementById('pos-root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PosApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Verify both entries build and the back-office is unaffected**

Run: `npm run build`
Expected: build succeeds; `dist/` contains both `index.html` and `pos.html` with separate JS bundles. Then `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add vite.config.js pos.html src/pos/main.tsx src/pos/PosApp.tsx
git commit -m "feat(pos-app): add pos.html Vite entry + scaffold"
```

---

## Task 2: i18n dictionary

**Files:**
- Create: `src/pos/i18n/strings.ts`
- Test: `src/pos/i18n/__tests__/strings.test.ts`

- [ ] **Step 1: Write the failing test `src/pos/i18n/__tests__/strings.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { t } from '../strings';

describe('t (i18n)', () => {
  it('returns Bahasa Indonesia by default', () => {
    expect(t('checkout.pay')).toBe('Bayar');
  });
  it('returns English when locale is en', () => {
    expect(t('checkout.pay', 'en')).toBe('Pay');
  });
  it('falls back to the key when missing', () => {
    expect(t('nonexistent.key' as never)).toBe('nonexistent.key');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/pos/i18n`
Expected: FAIL — cannot find module `../strings`.

- [ ] **Step 3: Implement `src/pos/i18n/strings.ts`**

```typescript
export type Locale = 'id' | 'en';

const dict = {
  'app.title':        { id: 'Kasir Apotek',        en: 'Pharmacy POS' },
  'auth.email':       { id: 'Email',               en: 'Email' },
  'auth.password':    { id: 'Kata sandi',          en: 'Password' },
  'auth.login':       { id: 'Masuk',               en: 'Log in' },
  'auth.logout':      { id: 'Keluar',              en: 'Log out' },
  'auth.forbidden':   { id: 'Anda tidak memiliki akses POS', en: 'You do not have POS access' },
  'shift.register':   { id: 'Kasir/Register',      en: 'Register' },
  'shift.openingFloat': { id: 'Modal awal',        en: 'Opening float' },
  'shift.open':       { id: 'Buka shift',          en: 'Open shift' },
  'shift.close':      { id: 'Tutup shift',         en: 'Close shift' },
  'shift.countedCash': { id: 'Uang tunai dihitung', en: 'Counted cash' },
  'shift.expected':   { id: 'Seharusnya',          en: 'Expected' },
  'shift.variance':   { id: 'Selisih',             en: 'Variance' },
  'shift.zreport':    { id: 'Laporan Z',           en: 'Z-report' },
  'checkout.scan':    { id: 'Pindai / cari barang', en: 'Scan / search item' },
  'checkout.total':   { id: 'Total',               en: 'Total' },
  'checkout.pay':     { id: 'Bayar',               en: 'Pay' },
  'checkout.qty':     { id: 'Jml',                 en: 'Qty' },
  'checkout.empty':   { id: 'Keranjang kosong',    en: 'Cart is empty' },
  'tender.cash':      { id: 'Tunai',               en: 'Cash' },
  'tender.received':  { id: 'Uang diterima',       en: 'Cash received' },
  'tender.change':    { id: 'Kembalian',           en: 'Change' },
  'tender.complete':  { id: 'Selesaikan',          en: 'Complete' },
  'receipt.title':    { id: 'Struk',               en: 'Receipt' },
  'receipt.print':    { id: 'Cetak',               en: 'Print' },
  'receipt.newSale':  { id: 'Transaksi baru',      en: 'New sale' },
  'common.cancel':    { id: 'Batal',               en: 'Cancel' },
} as const;

export type StringKey = keyof typeof dict;

/** Translate a key. Defaults to Bahasa Indonesia; falls back to the key if unknown. */
export function t(key: StringKey, locale: Locale = 'id'): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[locale] ?? key;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/pos/i18n`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pos/i18n
git commit -m "feat(pos-app): add i18n dictionary (Bahasa default)"
```

---

## Task 3: Cart model (pure)

**Files:**
- Create: `src/pos/state/cart.ts`
- Test: `src/pos/state/__tests__/cart.test.ts`

The cart holds catalog-derived lines; totals are computed by the shared `computeSaleTotals` (tax-inclusive) so client display matches the server.

- [ ] **Step 1: Write the failing test `src/pos/state/__tests__/cart.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { emptyCart, addItem, setQty, setDiscount, removeLine, cartTotal, type CatalogItem } from '../cart';

const paracetamol: CatalogItem = { id: 'i1', sku: 'PCT', name: 'Paracetamol', barcode: '899001', sellingPrice: 5000 };
const vitc: CatalogItem = { id: 'i2', sku: 'VITC', name: 'Vitamin C', barcode: '899002', sellingPrice: 10000 };

describe('cart', () => {
  it('adds an item as a new line with qty 1', () => {
    const c = addItem(emptyCart(), paracetamol);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ itemId: 'i1', quantity: 1, price: 5000, discountPct: 0 });
  });
  it('merges a repeat add into qty', () => {
    const c = addItem(addItem(emptyCart(), paracetamol), paracetamol);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].quantity).toBe(2);
  });
  it('sets qty and removes the line when qty <= 0', () => {
    let c = addItem(emptyCart(), paracetamol);
    c = setQty(c, 'i1', 3);
    expect(c.lines[0].quantity).toBe(3);
    c = setQty(c, 'i1', 0);
    expect(c.lines).toHaveLength(0);
  });
  it('applies a per-line discount and removes a line', () => {
    let c = addItem(addItem(emptyCart(), paracetamol), vitc);
    c = setDiscount(c, 'i2', 10);
    expect(c.lines.find((l) => l.itemId === 'i2')?.discountPct).toBe(10);
    c = removeLine(c, 'i1');
    expect(c.lines.map((l) => l.itemId)).toEqual(['i2']);
  });
  it('computes the tax-inclusive total', () => {
    let c = addItem(emptyCart(), paracetamol); // 2x5000
    c = setQty(c, 'i1', 2);
    c = addItem(c, vitc);                        // 1x10000 -10%
    c = setDiscount(c, 'i2', 10);
    expect(cartTotal(c)).toBe(19000); // 10000 + 9000
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/pos/state`
Expected: FAIL — cannot find module `../cart`.

- [ ] **Step 3: Implement `src/pos/state/cart.ts`**

```typescript
import { computeSaleTotals, type SaleLineInput } from '@/lib/pos/pricing';

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  sellingPrice: number;
}

export interface CartLine {
  itemId: string;
  name: string;
  price: number;      // tax-inclusive unit price
  quantity: number;
  discountPct: number;
}

export interface Cart {
  lines: CartLine[];
}

export function emptyCart(): Cart {
  return { lines: [] };
}

export function addItem(cart: Cart, item: CatalogItem): Cart {
  const existing = cart.lines.find((l) => l.itemId === item.id);
  if (existing) {
    return { lines: cart.lines.map((l) => (l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l)) };
  }
  return {
    lines: [...cart.lines, { itemId: item.id, name: item.name, price: item.sellingPrice, quantity: 1, discountPct: 0 }],
  };
}

export function setQty(cart: Cart, itemId: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, itemId);
  return { lines: cart.lines.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)) };
}

export function setDiscount(cart: Cart, itemId: string, discountPct: number): Cart {
  const clamped = Math.max(0, Math.min(100, discountPct));
  return { lines: cart.lines.map((l) => (l.itemId === itemId ? { ...l, discountPct: clamped } : l)) };
}

export function removeLine(cart: Cart, itemId: string): Cart {
  return { lines: cart.lines.filter((l) => l.itemId !== itemId) };
}

/** Sale lines in the server's input shape (reused for both display totals and the POST body). */
export function toSaleLines(cart: Cart): SaleLineInput[] {
  return cart.lines.map((l) => ({
    itemId: l.itemId,
    description: l.name,
    quantity: l.quantity,
    price: l.price,
    discountPct: l.discountPct,
  }));
}

export function cartTotal(cart: Cart): number {
  return computeSaleTotals(toSaleLines(cart), 11).totalAmount;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/pos/state`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pos/state
git commit -m "feat(pos-app): add pure cart model reusing server pricing"
```

---

## Task 4: POS API hooks

**Files:**
- Create: `src/pos/hooks/usePos.ts`

Thin TanStack Query wrappers over the shared `api`. Verified by typecheck + build (they exercise live endpoints, covered by e2e).

- [ ] **Step 1: Implement `src/pos/hooks/usePos.ts`**

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/src/api/apiClient';
import type { CatalogItem } from '../state/cart';
import type { SaleLineInput } from '@/lib/pos/pricing';

export interface PosRegister { id: string; code: string; name: string; warehouseId: string | null }
export interface CatalogRow extends CatalogItem { drugClass: string; requiresBatchTracking: boolean; qtyAvailable: number }
export interface OpenShiftResult { id: string; status: 'OPEN' }
export interface CloseShiftResult {
  status: 'CLOSED'; expectedCash: number; cashVariance: number;
  zReport: { totalSales: number; saleCount: number; cashCollected: number };
}
export interface PostSaleResult { posSaleId: string; salesInvoiceId: string; totalAmount: number; change: number }

export function useRegisters() {
  return useQuery({ queryKey: ['pos', 'registers'], queryFn: () => api.get<PosRegister[]>('/api/v1/pos/registers') });
}

export function useCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ['pos', 'catalog'],
    queryFn: () => api.get<CatalogRow[]>('/api/v1/pos/catalog'),
    enabled,
    staleTime: 60_000,
  });
}

export function useOpenShift() {
  return useMutation({
    mutationFn: (body: { registerId: string; openingFloat: number }) =>
      api.post<OpenShiftResult>('/api/v1/pos/shifts', body),
  });
}

export function useCloseShift() {
  return useMutation({
    mutationFn: ({ shiftId, countedCash }: { shiftId: string; countedCash: number }) =>
      api.post<CloseShiftResult>(`/api/v1/pos/shifts/${shiftId}/close`, { countedCash }),
  });
}

export function usePostSale() {
  return useMutation({
    mutationFn: (body: { clientSaleId: string; registerId: string; shiftId: string; lines: SaleLineInput[]; tenders: { method: 'CASH'; amount: number }[] }) =>
      api.post<PostSaleResult>('/api/v1/pos/sales', body),
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pos/hooks
git commit -m "feat(pos-app): add POS API hooks"
```

---

## Task 5: Login + shift views + PosApp view switch

**Files:**
- Create: `src/pos/views/LoginView.tsx`, `src/pos/views/ShiftOpenView.tsx`, `src/pos/views/ShiftCloseView.tsx`
- Modify: `src/pos/PosApp.tsx`

- [ ] **Step 1: Create `src/pos/views/LoginView.tsx`**

```tsx
import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { t } from '../i18n/strings';

export default function LoginView(): React.ReactElement {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('app.title')}</h1>
        <Input label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('auth.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} text={t('auth.login')} className="w-full" />
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pos/views/ShiftOpenView.tsx`**

```tsx
import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useRegisters, useOpenShift } from '../hooks/usePos';
import { t } from '../i18n/strings';

export default function ShiftOpenView({ onOpened }: { onOpened: (shiftId: string, registerId: string) => void }): React.ReactElement {
  const registers = useRegisters();
  const openShift = useOpenShift();
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const chosen = registerId || registers.data?.[0]?.id || '';

  async function open() {
    setError(null);
    try {
      const res = await openShift.mutateAsync({ registerId: chosen, openingFloat: Number(float) });
      onOpened(res.id, chosen);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-96 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('shift.open')}</h1>
        <label className="block text-sm font-medium">{t('shift.register')}</label>
        <select className="w-full rounded border p-2" value={chosen} onChange={(e) => setRegisterId(e.target.value)}>
          {(registers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <Input label={t('shift.openingFloat')} type="number" value={float} onChange={(e) => setFloat(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button variant="primary" text={t('shift.open')} loading={openShift.isPending} disabled={!chosen} onClick={open} className="w-full" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/pos/views/ShiftCloseView.tsx`**

```tsx
import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useCloseShift, type CloseShiftResult } from '../hooks/usePos';
import { t } from '../i18n/strings';

export default function ShiftCloseView({ shiftId, onClosed, onCancel }: { shiftId: string; onClosed: () => void; onCancel: () => void }): React.ReactElement {
  const closeShift = useCloseShift();
  const [counted, setCounted] = useState('0');
  const [result, setResult] = useState<CloseShiftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setError(null);
    try { setResult(await closeShift.mutateAsync({ shiftId, countedCash: Number(counted) })); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-96 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('shift.close')}</h1>
        {!result ? (
          <>
            <Input label={t('shift.countedCash')} type="number" value={counted} onChange={(e) => setCounted(e.target.value)} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" text={t('common.cancel')} onClick={onCancel} className="flex-1" />
              <Button variant="primary" text={t('shift.close')} loading={closeShift.isPending} onClick={close} className="flex-1" />
            </div>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>{t('shift.expected')}</span><span>{result.expectedCash.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between"><span>{t('shift.variance')}</span><span>{result.cashVariance.toLocaleString('id-ID')}</span></div>
            <div className="mt-2 border-t pt-2 font-medium">{t('shift.zreport')}</div>
            <div className="flex justify-between"><span>Total</span><span>{result.zReport.totalSales.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between"><span>Sales</span><span>{result.zReport.saleCount}</span></div>
            <Button variant="primary" text="OK" onClick={onClosed} className="mt-2 w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/pos/PosApp.tsx` with the view switch**

```tsx
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/src/stores/useAuthStore';
import LoginView from './views/LoginView';
import ShiftOpenView from './views/ShiftOpenView';
import ShiftCloseView from './views/ShiftCloseView';
import CheckoutView from './views/CheckoutView';

type Screen = { name: 'checkout' } | { name: 'closing' };

export default function PosApp(): React.ReactElement {
  const { user, isLoading, checkSession } = useAuthStore((s) => ({ user: s.user, isLoading: s.isLoading, checkSession: s.checkSession }));
  const [shift, setShift] = useState<{ shiftId: string; registerId: string } | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'checkout' });

  useEffect(() => { void checkSession(); }, [checkSession]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">…</div>;
  if (!user) return <LoginView />;
  if (!shift) return <ShiftOpenView onOpened={(shiftId, registerId) => setShift({ shiftId, registerId })} />;
  if (screen.name === 'closing') {
    return <ShiftCloseView shiftId={shift.shiftId} onClosed={() => { setShift(null); setScreen({ name: 'checkout' }); }} onCancel={() => setScreen({ name: 'checkout' })} />;
  }
  return <CheckoutView shiftId={shift.shiftId} registerId={shift.registerId} onCloseShift={() => setScreen({ name: 'closing' })} />;
}
```

- [ ] **Step 5: Verify typecheck (CheckoutView is created in Task 6 — expect a missing-module error until then)**

Run: `npm run typecheck`
Expected: the only error is `Cannot find module './views/CheckoutView'`. That's resolved in Task 6. (Do not commit a broken typecheck — commit Task 5 together with Task 6, OR create a temporary `CheckoutView` stub now and replace it in Task 6. Use the stub approach: create `src/pos/views/CheckoutView.tsx` exporting `export default function CheckoutView(_: { shiftId: string; registerId: string; onCloseShift: () => void }) { return null; }`, then typecheck clean, commit, and flesh it out in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add src/pos/views/LoginView.tsx src/pos/views/ShiftOpenView.tsx src/pos/views/ShiftCloseView.tsx src/pos/views/CheckoutView.tsx src/pos/PosApp.tsx
git commit -m "feat(pos-app): login + shift open/close views + app view switch"
```

---

## Task 6: Checkout view + ScanBox + cart lines + cash tender

**Files:**
- Create: `src/pos/components/ScanBox.tsx`, `src/pos/components/CartLines.tsx`, `src/pos/components/CashTenderModal.tsx`
- Replace: `src/pos/views/CheckoutView.tsx` (the stub from Task 5)

- [ ] **Step 1: Create `src/pos/components/ScanBox.tsx`**

```tsx
import React, { useRef } from 'react';
import Input from '@/src/components/UI/Input';
import { t } from '../i18n/strings';
import type { CatalogRow } from '../hooks/usePos';

export default function ScanBox({ catalog, onPick }: { catalog: CatalogRow[]; onPick: (item: CatalogRow) => void }): React.ReactElement {
  const [term, setTerm] = React.useState('');
  const ref = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    const byBarcode = catalog.find((c) => c.barcode === q);
    if (byBarcode) { onPick(byBarcode); setTerm(''); }
  }

  const matches = term.trim()
    ? catalog.filter((c) => c.name.toLowerCase().includes(term.toLowerCase()) || c.sku.toLowerCase().includes(term.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <form onSubmit={submit}>
        <Input inputClassName="text-lg" placeholder={t('checkout.scan')} value={term} onChange={(e) => setTerm(e.target.value)} />
      </form>
      {matches.length > 0 && (
        <ul className="mt-1 max-h-64 overflow-auto rounded border bg-white">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-gray-50" onClick={() => { onPick(m); setTerm(''); ref.current?.focus(); }}>
                <span>{m.name}</span><span className="text-gray-500">{m.sellingPrice.toLocaleString('id-ID')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pos/components/CartLines.tsx`**

```tsx
import React from 'react';
import { Trash2 } from 'lucide-react';
import type { Cart } from '../state/cart';
import { t } from '../i18n/strings';

export default function CartLines({ cart, onQty, onRemove }: { cart: Cart; onQty: (itemId: string, qty: number) => void; onRemove: (itemId: string) => void }): React.ReactElement {
  if (cart.lines.length === 0) return <p className="p-8 text-center text-gray-400">{t('checkout.empty')}</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {cart.lines.map((l) => (
          <tr key={l.itemId} className="border-b">
            <td className="py-2">{l.name}</td>
            <td className="py-2 text-center">
              <input aria-label={t('checkout.qty')} type="number" min={0} value={l.quantity}
                className="w-16 rounded border p-1 text-center"
                onChange={(e) => onQty(l.itemId, Number(e.target.value))} />
            </td>
            <td className="py-2 text-right">{(l.price * l.quantity * (1 - l.discountPct / 100)).toLocaleString('id-ID')}</td>
            <td className="py-2 pl-2 text-right">
              <button aria-label="remove" onClick={() => onRemove(l.itemId)}><Trash2 size={16} className="text-gray-400 hover:text-red-600" /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create `src/pos/components/CashTenderModal.tsx`**

```tsx
import React, { useState } from 'react';
import Modal from '@/src/components/UI/Modal';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { validateCashTender } from '@/lib/pos/tender';
import { t } from '../i18n/strings';

export default function CashTenderModal({ total, isOpen, onClose, onConfirm, busy }: { total: number; isOpen: boolean; onClose: () => void; onConfirm: (cash: number) => void; busy: boolean }): React.ReactElement {
  const [cash, setCash] = useState('');
  const cashNum = Number(cash) || 0;
  const res = validateCashTender(total, cashNum);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('tender.cash')} size="sm">
      <div className="space-y-4">
        <div className="flex justify-between text-lg font-semibold"><span>{t('checkout.total')}</span><span>{total.toLocaleString('id-ID')}</span></div>
        <Input label={t('tender.received')} type="number" value={cash} onChange={(e) => setCash(e.target.value)} />
        <div className="flex justify-between"><span>{t('tender.change')}</span><span>{res.ok ? res.change.toLocaleString('id-ID') : '—'}</span></div>
        <Button variant="primary" className="w-full" disabled={!res.ok} loading={busy} text={t('tender.complete')} onClick={() => onConfirm(cashNum)} />
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Replace `src/pos/views/CheckoutView.tsx`**

```tsx
import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { useCatalog, usePostSale, type CatalogRow, type PostSaleResult } from '../hooks/usePos';
import { emptyCart, addItem, setQty, removeLine, cartTotal, toSaleLines, type Cart } from '../state/cart';
import ScanBox from '../components/ScanBox';
import CartLines from '../components/CartLines';
import CashTenderModal from '../components/CashTenderModal';
import ReceiptView from './ReceiptView';
import { t } from '../i18n/strings';

function uuid(): string {
  return (crypto as Crypto).randomUUID();
}

export default function CheckoutView({ shiftId, registerId, onCloseShift }: { shiftId: string; registerId: string; onCloseShift: () => void }): React.ReactElement {
  const logout = useAuthStore((s) => s.logout);
  const catalog = useCatalog(true);
  const postSale = usePostSale();
  const [cart, setCart] = useState<Cart>(emptyCart());
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ result: PostSaleResult; lines: Cart } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saleId, setSaleId] = useState(uuid());

  if (catalog.isError && (catalog.error as Error).message.includes('403')) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{t('auth.forbidden')}</div>;
  }
  if (receipt) {
    return <ReceiptView result={receipt.result} cart={receipt.lines} onNew={() => { setReceipt(null); setCart(emptyCart()); setSaleId(uuid()); }} />;
  }

  const total = cartTotal(cart);

  async function pay(cash: number) {
    setError(null);
    try {
      const result = await postSale.mutateAsync({ clientSaleId: saleId, registerId, shiftId, lines: toSaleLines(cart), tenders: [{ method: 'CASH', amount: cash }] });
      setPayOpen(false);
      setReceipt({ result, lines: cart });
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <span className="font-semibold">{t('app.title')}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" text={t('shift.close')} onClick={onCloseShift} />
          <Button variant="ghost" size="sm" text={t('auth.logout')} onClick={() => logout()} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <ScanBox catalog={catalog.data ?? []} onPick={(item: CatalogRow) => setCart((c) => addItem(c, item))} />
        <div className="mt-4 rounded-lg bg-white p-4 shadow">
          <CartLines cart={cart} onQty={(id, q) => setCart((c) => setQty(c, id, q))} onRemove={(id) => setCart((c) => removeLine(c, id))} />
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <span className="text-xl font-bold">{t('checkout.total')}: {total.toLocaleString('id-ID')}</span>
            <Button variant="primary" size="lg" text={t('checkout.pay')} disabled={cart.lines.length === 0} onClick={() => setPayOpen(true)} />
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </main>
      <CashTenderModal total={total} isOpen={payOpen} onClose={() => setPayOpen(false)} onConfirm={pay} busy={postSale.isPending} />
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck + build**

Run: `npm run typecheck` (expect clean) then `npm run build` (both entries build).

- [ ] **Step 6: Commit**

```bash
git add src/pos/components src/pos/views/CheckoutView.tsx
git commit -m "feat(pos-app): checkout view with scan, cart, and cash tender"
```

---

## Task 7: Receipt view + print CSS

**Files:**
- Create: `src/pos/views/ReceiptView.tsx`, `src/pos/styles/print.css`
- Modify: `src/pos/main.tsx` (import print.css)

- [ ] **Step 1: Create `src/pos/styles/print.css`**

```css
@media print {
  body * { visibility: hidden; }
  #pos-receipt, #pos-receipt * { visibility: visible; }
  #pos-receipt { position: absolute; left: 0; top: 0; width: 80mm; font-size: 12px; }
  .no-print { display: none !important; }
}
```

- [ ] **Step 2: Create `src/pos/views/ReceiptView.tsx`**

```tsx
import React from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import type { Cart } from '../state/cart';
import type { PostSaleResult } from '../hooks/usePos';
import { computeSaleTotals } from '@/lib/pos/pricing';
import { toSaleLines } from '../state/cart';
import { t } from '../i18n/strings';

export default function ReceiptView({ result, cart, onNew }: { result: PostSaleResult; cart: Cart; onNew: () => void }): React.ReactElement {
  const org = useAuthStore((s) => s.org) as { name?: string; legalName?: string; displayName?: string } | null;
  const totals = computeSaleTotals(toSaleLines(cart), 11);
  const storeName = org?.displayName ?? org?.legalName ?? org?.name ?? 'Apotek';

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div id="pos-receipt" className="mx-auto max-w-xs bg-white p-4 text-sm shadow">
        <div className="text-center font-semibold">{storeName}</div>
        <div className="text-center text-xs text-gray-500">No: {result.salesInvoiceId.slice(-8)}</div>
        <hr className="my-2" />
        {cart.lines.map((l) => (
          <div key={l.itemId} className="flex justify-between">
            <span>{l.quantity}× {l.name}</span>
            <span>{(l.price * l.quantity * (1 - l.discountPct / 100)).toLocaleString('id-ID')}</span>
          </div>
        ))}
        <hr className="my-2" />
        <div className="flex justify-between"><span>PPN</span><span>{totals.taxAmount.toLocaleString('id-ID')}</span></div>
        <div className="flex justify-between font-bold"><span>{t('checkout.total')}</span><span>{result.totalAmount.toLocaleString('id-ID')}</span></div>
        <div className="flex justify-between"><span>{t('tender.change')}</span><span>{result.change.toLocaleString('id-ID')}</span></div>
      </div>
      <div className="no-print mx-auto mt-4 flex max-w-xs gap-2">
        <Button variant="secondary" className="flex-1" text={t('receipt.print')} onClick={() => window.print()} />
        <Button variant="primary" className="flex-1" text={t('receipt.newSale')} onClick={onNew} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Import the print CSS in `src/pos/main.tsx`** — add after `import '../index.css';`:

```tsx
import './styles/print.css';
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck` then `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/pos/views/ReceiptView.tsx src/pos/styles/print.css src/pos/main.tsx
git commit -m "feat(pos-app): printable receipt view"
```

---

## Task 8: Playwright e2e spec + final regression

**Files:**
- Create: `e2e/pos-checkout.spec.ts`

The e2e runs against the dev server + backend + **dev DB seeded** with the Slice-1 POS fixtures and a stocked batch-tracked item. It's a committed deliverable; running it is a manual/integration step (see the note in Conventions). CI-runnable gates are unit + typecheck + build.

- [ ] **Step 1: Create `e2e/pos-checkout.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

// Prereqs to RUN this locally (not run in the default unit CI):
//   1) Dev DB seeded: `npm run db:seed` (adds POS Operator role, WALK-IN customer, REG-1),
//      plus at least one active PRODUCT item with a non-expired StockBatch on REG-1's warehouse.
//   2) Servers up: `npm run dev` (:5173) and `npm run backend:dev` (:3000).
//   3) A cashier login exists (e.g. cashier@demo.com / cashier123 from the seed).
test.describe('POS cashier checkout', () => {
  test('login, open shift, sell an item for cash, see receipt', async ({ page }) => {
    await page.goto('/pos.html');
    await page.fill('input[type="email"]', 'cashier@demo.com');
    await page.fill('input[type="password"]', 'cashier123');
    await page.click('button[type="submit"]');

    // Shift open screen
    await expect(page.getByText('Buka shift')).toBeVisible();
    await page.fill('input[type="number"]', '100000');
    await page.getByRole('button', { name: 'Buka shift' }).click();

    // Checkout: search an item and add it
    await page.getByPlaceholder('Pindai / cari barang').fill('Paracetamol');
    await page.getByRole('button', { name: /Paracetamol/ }).first().click();

    // Pay
    await page.getByRole('button', { name: 'Bayar' }).click();
    await page.getByLabel('Uang diterima').fill('50000');
    await page.getByRole('button', { name: 'Selesaikan' }).click();

    // Receipt
    await expect(page.getByText('Kembalian')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transaksi baru' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Confirm the e2e spec compiles (typecheck includes e2e)**

Run: `npm run typecheck`
Expected: no errors (the spec is type-valid even though it isn't run here).

- [ ] **Step 3: Final regression (CI-runnable gates)**

Run each:
- `npm test` — all unit tests pass (existing + new POS-app pure-logic: i18n, cart).
- `npm run typecheck` — clean.
- `npm run build` — both `index.html` and `pos.html` entries build.

Confirm the back-office bundle is unaffected (build output still emits the main entry; no changes to `index.html`/`src/main.tsx`).

- [ ] **Step 4: Commit**

```bash
git add e2e/pos-checkout.spec.ts
git commit -m "test(pos-app): Playwright e2e for the cashier checkout happy path"
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** pos.html entry + kiosk isolation (Task 1) ✓; reuse auth login (Task 5 LoginView + useAuthStore) ✓; register + shift open/close + Z-report (Tasks 4,5) ✓; barcode/search + cart + qty/discount (Tasks 3,6) ✓; cash tender + change (Task 6, reuses validateCashTender) ✓; HTML thermal receipt + print (Task 7) ✓; Bahasa default i18n (Task 2) ✓; server-authoritative totals (client uses computeSaleTotals for display; receipt uses server `result`) ✓; unit tests (i18n, cart) + Playwright e2e (Task 8) ✓; back-office unchanged (Task 1/8 build gate) ✓. Out-of-scope items (offline/SW, QRIS, returns, dispensing) intentionally absent.
- **Placeholder scan:** none — every step has real code/commands. Task 5 Step 5 explicitly resolves the forward-reference to CheckoutView via a typed stub committed in Task 5 and fleshed out in Task 6 (no broken intermediate typecheck).
- **Type consistency:** `CatalogRow`/`CatalogItem`, `Cart`/`CartLine`, `PostSaleResult`, `toSaleLines`, `cartTotal`, `computeSaleTotals`, `validateCashTender` names are used identically across cart.ts, hooks, and views. `useAuthStore` selectors match the verified store shape (`user`, `org`, `isLoading`, `login`, `logout`, `checkSession`).
- **Known verification points (not placeholders):** (a) confirm `useAuthStore` exposes `checkSession`/`isLoading`/`org` exactly as used (verified in the conventions report); (b) `crypto.randomUUID()` is available in the target browsers (modern Chrome — fine for a POS terminal); (c) the `api` client throws `Error` whose `.message` may be the server text — the 403 check in CheckoutView matches on `'403'` via the `API error 403` fallback message; if `ok()` errors surface differently, adjust the 403 detection during Task 6.

---

## Follow-on (later slices)

Offline slice: add `vite-plugin-pwa` + a web manifest (installable/kiosk), Dexie catalog cache fed by `GET /api/v1/pos/catalog`, an IndexedDB outbound queue for sales posting to `POST /api/v1/pos/sales` (idempotent via the `clientSaleId` this slice already generates), and background sync + a Playwright offline→reconnect test. Then: dynamic QRIS/e-wallet tenders, returns/refunds, and the dispensing/Rx UI.
```
