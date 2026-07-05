# Pharmacy POS — Slice 2: Cashier App (online) — Design Spec

**Date:** 2026-07-05
**Status:** Draft for review
**Builds on:** Slice 1 backend (merged, PR #97) — `docs/superpowers/specs/2026-07-03-pharmacy-pos-foundation-checkout-design.md`
**Builds inside:** MSM Accounting Software monorepo, branch `pharmacy-pos-pwa`

---

## 1. Context & decisions

Slice 1 delivered the POS backend: a cash OTC sale posts a native `SalesInvoice` + cash `ARPayment` +
FEFO `StockBatch` decrement via the existing engine, exposed at `/api/v1/pos/*` and gated by
`POS_RETAIL`. Slice 2 is the **cashier-facing app** that drives those endpoints.

Decisions locked during brainstorming:

| Decision | Choice |
|----------|--------|
| Slice scope | **Online-first** cashier app. Offline cache/queue/sync + service worker are the NEXT slice. |
| App shape | New Vite entry `pos.html` → `src/pos/` (multi-page build), kiosk-isolated from the back-office SPA |
| Auth | Reuse existing email/password login → `msm_token` cookie (same origin). Cashier = user with the POS Operator role. |
| Receipt | Browser print of a 58/80mm-styled HTML receipt (`window.print()` + `@media print`). No ESC/POS. |
| Barcode | Standard keyboard-wedge scanners (type barcode + Enter into a focused input). No device integration. |
| Tender | Cash only (matches the Slice-1 backend). |
| Returns/refunds | Deferred (no POS return endpoint exists yet). |
| i18n | Tiny hand-rolled dictionary, Bahasa Indonesia default, English fallback. No i18n library. |
| Deps added | None required beyond what's installed. (No `vite-plugin-pwa`/`dexie` yet — those arrive with the offline slice.) |

## 2. Scope

**In scope — a cashier can complete a shift of cash sales end to end:**

1. New `pos.html` Vite entry + `src/pos/` React root, built alongside the back-office app.
2. Login (reuse auth API), with logout.
3. Register selection + shift open (opening float) / close (counted cash → expected/variance + Z-report).
4. Keyboard/barcode-first checkout: scan or search → cart (qty, per-line discount, remove) → running total.
5. Cash tender: amount received → change → post sale via `POST /api/v1/pos/sales`.
6. HTML thermal receipt (58/80mm) rendered + printed; shown on screen.
7. Bahasa Indonesia UI (id default, en fallback).
8. Unit tests (cart reducer, tender/change display) + a Playwright e2e for the happy path.

**Out of scope (later slices):** offline cache/queue/sync + service worker + installable manifest; dynamic
QRIS/e-wallet/EDC tenders; dispensing/Rx/pharmacist-auth/controlled-substance UI; returns/refunds; hold/resume
of parked carts; multi-language beyond id/en; hardware ESC/POS / cash-drawer kick; PIN login.

## 3. Architecture

```
MSM repo
├── index.html                    (existing back-office entry — unchanged)
├── pos.html                      NEW — POS entry, loads src/pos/main.tsx
├── vite.config.js                MODIFY — build.rollupOptions.input = { main: index.html, pos: pos.html }
└── src/pos/                      NEW — the cashier app (own React root)
    ├── main.tsx                  mounts <PosApp/> into #root, wraps QueryClientProvider
    ├── PosApp.tsx                top-level view switch (auth → shift → checkout) + i18n provider
    ├── api/pos-client.ts         typed fetch wrappers for /api/v1/pos/* + /api/v1/auth
    ├── hooks/                    useCatalog, useRegisters, useShift, usePostSale (TanStack Query)
    ├── state/cart.ts             pure cart reducer (add/scan, setQty, setDiscount, remove, totals)
    ├── views/
    │   ├── LoginView.tsx
    │   ├── ShiftOpenView.tsx     pick register + opening float
    │   ├── ShiftCloseView.tsx    counted cash → expected/variance + Z-report
    │   ├── CheckoutView.tsx      scan box + cart + totals + pay
    │   └── ReceiptView.tsx       on-screen + print layout
    ├── components/               ScanBox, CartLine, CashTenderModal, NumberPad(optional)
    ├── i18n/strings.ts           { id: {...}, en: {...} } + t(key) helper, id default
    └── styles/print.css          @media print — 58/80mm receipt sizing
```

The POS app authenticates with the same `msm_token` httpOnly cookie the back-office login sets, so no
new auth code is needed on the server. All data flows through the Slice-1 endpoints; the **server is
authoritative** for posted totals, tax, and stock — the client computes totals only for live display.

## 4. Screens & flow

State-driven (no router dependency). On load, `PosApp` resolves: not authenticated → `LoginView`;
authenticated but no OPEN shift for the chosen register → `ShiftOpenView`; else → `CheckoutView`.
`CheckoutView` → (Complete) → `ReceiptView` → (New sale) → back to `CheckoutView`. A header action opens
`ShiftCloseView`; closing returns to `ShiftOpenView`/`LoginView`.

## 5. Checkout behaviour

- A persistently-focused **ScanBox**. Enter with an exact `barcode` match → add that item (qty +1 if already
  in cart). Enter with non-matching text → keep it as a search filter over the catalog; clicking a result adds it.
- **Cart** (client `state/cart.ts`): line qty (± and manual entry), per-line discount %, remove line; derived
  running subtotal/total (tax-inclusive display mirroring server math). Empty-cart guard on pay.
- **CashTenderModal:** enter cash received (a quick-amount pad optional); shows change; **Complete** is disabled
  until cash ≥ total. Complete generates a `clientSaleId` (UUID) and calls `POST /api/v1/pos/sales` with
  `{ clientSaleId, registerId, shiftId, lines, tenders:[{method:'CASH', amount}] }`.
- On success → `ReceiptView` with the server response (invoice number, totals, change). On error → inline
  message; the cashier can retry (same `clientSaleId` is reused so a retry after a timeout is idempotent).
- Function keys: F2 focus search, F4 open pay, Esc close modal/clear. (Documented, minimal.)

## 6. Receipt

`ReceiptView` renders store header (org name/address), date/time, cashier, line items (name, qty, price,
line total), subtotal, PPN, total, cash tendered, change, invoice number, and per-line batch/expiry where
present. `styles/print.css` `@media print` constrains width (`58mm`/`80mm` via a body class) and hides app
chrome. A **Print** button calls `window.print()`; auto-print-on-complete is optional/configurable.

## 7. i18n

`i18n/strings.ts` exports `t(key, locale='id')` over a `{ id, en }` dictionary covering all POS UI strings.
Default `id`. A small locale toggle in the header switches to `en` (admin convenience). No pluralization
engine needed for this string set.

## 8. Error & edge handling

- Auth 401 from any POS call → bounce to `LoginView` (cookie expired).
- 403 (missing `POS_RETAIL`) → a clear "not authorized for POS" screen.
- Sale rejected (e.g. insufficient batch stock, shift not open, shift↔register mismatch) → show the server's
  message inline; do not clear the cart, let the cashier fix and retry.
- Catalog `qtyAvailable` is advisory for display; the server is the source of truth and may still reject on post.
- Network failure on post → keep the cart + `clientSaleId`, allow retry (idempotent).

## 9. Testing

- **Unit (vitest, in `src/pos/**/__tests__`):** `state/cart.ts` reducer (scan-add, merge same item, qty,
  line discount, remove, totals, empty-cart), and the tender/change display helper.
- **E2E (Playwright, existing `e2e/` harness):** `pos-checkout.spec.ts` — log in as the seeded cashier, open a
  shift, scan/add an item, pay cash, assert the receipt shows the right total + change and that a corresponding
  `PosSale`/`SalesInvoice` exists; plus open→sale→close showing the Z-report. Runs against the dev server + API
  + test DB (reuse the Slice-1 seed: POS Operator role, walk-in customer, REG-1 register — seed a batch-tracked
  item with stock in the test setup).

## 10. Acceptance criteria

1. Visiting `pos.html` unauthenticated shows the POS login; valid POS-Operator credentials reach the shift screen.
2. Opening a shift with a float, scanning a barcode, and paying cash produces the correct change and a printed
   receipt, and posts a `SalesInvoice` + cash `ARPayment` (verified via the Slice-1 backend).
3. Free-text search adds an item; qty and per-line discount update the total correctly.
4. Completing a sale with cash < total is impossible (Complete disabled); an over-tender shows correct change.
5. A server rejection (e.g. insufficient stock) shows the message and preserves the cart.
6. Closing the shift shows expected vs counted cash, variance, and a Z-report.
7. The back-office SPA (`index.html`) is unchanged and still builds; the POS entry ships as its own bundle.
8. UI defaults to Bahasa Indonesia.

## 11. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Multi-entry Vite build misconfigured (back-office breaks) | Add `pos.html` as a second `rollupOptions.input`; acceptance criterion 7 asserts the back-office still builds; keep entries fully separate |
| Client vs server total mismatch confuses cashier | Server is authoritative; client total is display-only; the receipt always uses the server response |
| Cookie/session sharing across entries | Same origin + same `msm_token` cookie; a POS 401 bounces to login |
| Scope creep (offline, returns, QRIS) | Hard out-of-scope list (§2); this slice is online cash-only |
| e2e flakiness (server+DB) | Reuse the existing Playwright setup + Slice-1 seed; keep the happy-path e2e small and deterministic |
```
