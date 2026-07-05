# Pharmacy POS — Slice 3: Offline-first (installable PWA + sync) — Design Spec

**Date:** 2026-07-05
**Status:** Draft for review
**Builds on:** Slice 1 backend (`/api/v1/pos/*`) + Slice 2 cashier app + the checkout redesign — all merged to `main`.
**Builds inside:** MSM Accounting Software monorepo, branch `pharmacy-pos-offline`

---

## 1. Context & decisions

The POS cashier app (`pos.html` → `src/pos/`) works online. This slice makes it keep working when the
internet drops: the cashier can open/close a shift and ring up cash sales offline, and everything syncs
when the connection returns. The app also becomes an installable PWA (kiosk).

Decisions locked during brainstorming:

| Decision | Choice |
|----------|--------|
| Offline scope | Cash sales **and** shift open/close work offline (queued). Everything else needs online. |
| Installable | Yes — web manifest + service worker; installs standalone/full-screen. |
| Sync conflicts | A queued op that fails on sync (e.g. oversell) is **flagged in an Exceptions list** for the pharmacist to reconcile; it is not auto-forced. |
| Sync trigger | **Automatic** (on reconnect + app focus) **plus a manual "Sync now" button** with a queued-count badge. |
| Source of truth | Server remains authoritative for stock + GL. Offline cash sales are constrained to safe operations. |
| Out of scope | Non-cash tenders offline, two-way stock pull/merge, multi-device shift sharing, background push, QRIS/dispensing/SATUSEHAT. |

## 2. Scope

**In scope:**
1. `pos` entry becomes an installable PWA: `vite-plugin-pwa` (Workbox) precaches the app shell; web manifest (standalone, icons, start_url `/pos.html`). Back-office entry untouched.
2. Local store (Dexie/IndexedDB): cached `catalog` + `registers`, an `outbox` operation queue, and `shiftState`.
3. Offline **shift open/close** and **cash sales**, queued locally; receipts print from local data offline.
4. **Sync engine**: drains the outbox in order, idempotently, on reconnect / focus / manual button.
5. **Exceptions list**: failed sync ops surfaced for review.
6. Offline/online + queued-count indicators; per-sale sync status.
7. Backend: `PosShift.clientShiftId` (idempotent shift-open); idempotent shift-close.

**Out of scope:** see the decisions table.

## 3. Architecture

```
src/pos/
├── offline/
│   ├── db.ts            Dexie schema: catalog, registers, outbox, shiftState
│   ├── outbox.ts        pure queue reducer (enqueue, markSynced/Failed, reorder, rewriteShiftId)
│   ├── connectivity.ts  online detection (navigator.onLine + API ping) as a hook/store
│   └── sync.ts          sync engine: drain outbox in order, idempotent, update local + surface failures
├── hooks/useOfflinePos.ts  offline-aware wrappers: cache catalog on load; enqueue shift/sale when offline
├── components/OfflineBar.tsx  online/offline + queued badge + "Sync now"
├── views/ExceptionsView.tsx   failed-op list for reconciliation
└── (existing views wired to the offline-aware hooks)
vite.config.js           + VitePWA plugin on the pos entry
pos.html / manifest       PWA manifest + icons
```

Backend:
```
prisma/schema.prisma                 + PosShift.clientShiftId (nullable, @@unique([organizationId, clientShiftId]))
lib/pos/shift.ts                      openShift accepts clientShiftId + is idempotent on it; closeShift idempotent
src/app/api/v1/pos/shifts/route.ts    POST passes clientShiftId; shifts/[id]/close idempotent
```

## 4. Data model (offline, IndexedDB)

- `catalog`: the latest `GET /api/v1/pos/catalog` rows (id, sku, name, barcode, sellingPrice, drugClass, requiresBatchTracking, qtyAvailable, earliestExpiry). Overwritten on each successful online fetch.
- `registers`: the latest `GET /api/v1/pos/registers`.
- `outbox`: `{ localId (uuid), type: 'shift-open'|'sale'|'shift-close', payload, status: 'pending'|'synced'|'failed', error?, serverId?, createdAt, clientShiftId }`. FIFO within a shift; sales carry their `clientShiftId`.
- `shiftState`: `{ clientShiftId, serverShiftId?, registerId, status: 'OPEN'|'CLOSED', openingFloat }` — the current shift so an offline reload resumes into checkout.

## 5. IDs & reconciliation

- Sales already carry a device-generated **`clientSaleId`** (idempotent). Add **`clientShiftId`** for offline-opened shifts.
- Offline: open shift → `shiftState` + an `outbox` `shift-open` op keyed by `clientShiftId`; each sale references that `clientShiftId`; close → an `outbox` `shift-close` op.
- **Sync order per shift:** push `shift-open` → server returns the real `shiftId` (idempotent on `clientShiftId`) → the sync engine **rewrites** the queued sales' `shiftId` to the real one → push each `sale` (idempotent on `clientSaleId`) → push `shift-close`. The **sales endpoint is unchanged** — it always receives a real `shiftId`.
- Online (connected) behaves as today: shift-open/sale/close go straight to the server; the outbox stays empty. The offline path only engages when a request can't reach the server.

## 6. Sync engine

Triggers: the browser `online` event, app focus/visibility, and a manual **"Sync now"**. On trigger, verify real connectivity (a lightweight `GET /api/v1/pos/registers` or a ping), then drain the `outbox` FIFO:

1. `shift-open` → `POST /api/v1/pos/shifts` with `clientShiftId`; store `serverShiftId`; rewrite dependent sales.
2. `sale` → `POST /api/v1/pos/sales` (real `shiftId`, `clientSaleId`).
3. `shift-close` → `POST /api/v1/pos/shifts/{serverShiftId}/close`.

Each op: on 2xx → `synced`; on a business rejection (400, e.g. insufficient stock / period closed) → `failed` + record the server message; on a network error → leave `pending` (retry next trigger). Idempotency (`clientShiftId`/`clientSaleId`) makes replays safe. Server stays authoritative for stock + GL.

## 7. Exceptions handling

A `failed` op appears in an **Exceptions list** (`ExceptionsView`) with the item, reason (server message), and timestamp. The pharmacist reviews and reconciles out-of-band (e.g. a stock adjustment) — the sale physically happened while offline. Failed ops are not auto-retried or auto-forced. A badge shows the exception count.

## 8. Offline UX

`OfflineBar` (in the status bar): an online/offline dot, the pending-queue count, an exceptions count, and a **Sync now** button (disabled while offline or empty). Each receipt/sale row shows its sync state. Cash tender, change, and receipt printing already work fully from local data offline; the product grid renders from the cached `catalog`.

## 9. Backend changes (additive)

- `PosShift.clientShiftId String?` + `@@unique([organizationId, clientShiftId])`. Migration via `prisma db push` (additive).
- `openShift(tx, orgId, { registerId, cashierId, openingFloat, clientShiftId? })`: if `clientShiftId` already exists for the org, return that shift (idempotent) instead of the "already open" 409 — so a sync replay is safe. Keep the one-open-shift-per-register guard for the non-clientShiftId path.
- `closeShift`: closing an already-CLOSED shift returns its stored result instead of throwing (idempotent).
- `POST /api/v1/pos/shifts` accepts optional `clientShiftId` (zod) and passes it through.

## 10. Testing

- **Unit (vitest):** `outbox.ts` reducer (enqueue, markSynced/Failed, rewriteShiftId, FIFO), `connectivity` logic.
- **Integration (test DB):** `openShift` idempotent on `clientShiftId` (replay → one shift); `closeShift` idempotent (second close → same result, no throw).
- **E2E (Playwright):** with the browser context offline — open a shift, ring a cash sale (receipt prints); go online — assert the outbox drains, the shift + sale exist server-side exactly once, and the queue empties. A conflict variant: pre-sell the stock server-side, then sync an offline sale → it lands in Exceptions.

## 11. Acceptance criteria

1. `pos.html` is installable (manifest + SW) and launches offline (cached shell).
2. With the network off, the cashier opens a shift, rings a cash sale, and prints a receipt — all locally.
3. On reconnect (auto or "Sync now"), the queue drains: the shift and sale post server-side exactly once (idempotent), and the badge returns to zero.
4. A queued sale that the server rejects on sync appears in the Exceptions list with the reason; nothing double-posts.
5. Reloading the app while offline resumes into the open shift (from `shiftState`).
6. Online behavior is unchanged (outbox stays empty; requests go straight through).
7. The back-office entry and existing tests are unaffected; the schema change is additive.

## 12. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Offline shift/sale ID reconciliation is complex | Client-side ordered sync (shift-open → rewrite → sales → close); idempotency keys make replays safe; sales endpoint unchanged |
| Stock drift while offline → oversell | Server authoritative; rejected sales flagged in Exceptions for human reconcile (accepted trade-off) |
| Service worker caching stale app shell | Workbox precache with revisioned assets + auto-update on new deploy; catalog is data (IndexedDB), not SW-cached |
| PWA/SW breaking the online app or back-office | SW scoped to the pos entry; back-office entry untouched; test both build + run |
| Double-posting on retry | `clientShiftId` + `clientSaleId` unique/idempotent on the server |
```
