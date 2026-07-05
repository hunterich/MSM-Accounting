# Pharmacy POS — Offline-first (PWA + sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the POS cashier app work offline — installable PWA, cash sales + shift open/close queued in IndexedDB, drained by an idempotent sync engine on reconnect, with failed ops surfaced in an Exceptions list.

**Architecture:** Add `vite-plugin-pwa` (service worker + manifest) to the `pos` entry, `dexie` for IndexedDB. A pure `outbox` reducer holds queued ops; a `sync` engine drains it in order (`shift-open` → rewrite sale shift-ids → `sales` → `close`), idempotent via device-generated `clientShiftId`/`clientSaleId`. Server stays authoritative; rejected ops go to an Exceptions view. Backend change is additive: `PosShift.clientShiftId` + idempotent open/close.

**Tech Stack:** React 19, Vite (multi-entry), TanStack Query, Dexie (IndexedDB), vite-plugin-pwa (Workbox), TypeScript, Vitest, Playwright, Prisma/PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-07-05-pharmacy-pos-offline-design.md`
**Branch:** `pharmacy-pos-offline` (off `main`).

---

## Conventions (verified while building slices 1–2)

- POS app lives in `src/pos/`. API via `import { api } from '@/src/api/apiClient'` (`api.get/post`, unwrapped `ok()` responses, throws `Error` with a `.status` property on non-2xx). Auth via `useAuthStore`. Query client is a POS-local one in `src/pos/main.tsx`.
- Backend: `lib/pos/shift.ts` (`openShift`, `closeShift`), `src/app/api/v1/pos/shifts/route.ts` (POST open, GET open-shifts), `src/app/api/v1/pos/shifts/[id]/close/route.ts`, zod in `types/api.ts` (`openPosShiftSchema`).
- Schema is schema-first: apply with `npx prisma db push` (additive), not migrate. Client regen: `npm run prisma:generate`.
- Tests: `npm test` (unit/vitest), `npm run test:int` (integration, real `_test` DB, via `lib/__tests__/integration/harness.ts` → `createTestOrg`, `prisma`, `cleanupOrg`, `disconnect`), `npm run typecheck`, `npm run build`, `npm run test:e2e` (Playwright; needs `npm run dev` + `npm run backend:dev` + seeded dev DB).
- SAFETY: never run destructive DB commands on the dev DB; integration tests use the `_test` DB (`npm run test:int:setup`).

---

## File Structure

```
prisma/schema.prisma                       + PosShift.clientShiftId + unique
lib/pos/shift.ts                           openShift(clientShiftId?) idempotent; closeShift idempotent
types/api.ts                               openPosShiftSchema + clientShiftId
src/app/api/v1/pos/shifts/route.ts         pass clientShiftId
package.json                               + dexie, vite-plugin-pwa
vite.config.js                             + VitePWA plugin
pos.html                                   + manifest link (plugin-injected)
public/pos-icon-192.png, pos-icon-512.png  PWA icons
src/pos/main.tsx                           register service worker
src/pos/offline/
├── db.ts                                  Dexie schema (catalog, registers, outbox, shiftState)
├── outbox.ts                              pure queue reducer (+ __tests__/outbox.test.ts)
├── connectivity.ts                        online detection (+ __tests__/connectivity.test.ts)
└── sync.ts                                sync engine (+ __tests__/sync.test.ts)
src/pos/hooks/useOfflinePos.ts             offline-aware shift/sale/catalog operations
src/pos/components/OfflineBar.tsx          online/queue/exceptions indicator + Sync now
src/pos/views/ExceptionsView.tsx           failed-op list
e2e/pos-offline.spec.ts                    offline → reconnect e2e
```

---

## Task 1: Backend — `clientShiftId` + idempotent open/close

**Files:**
- Modify: `prisma/schema.prisma`, `lib/pos/shift.ts`, `types/api.ts`, `src/app/api/v1/pos/shifts/route.ts`
- Test: `lib/__tests__/integration/pos-offline-shift.int.test.ts`

- [ ] **Step 1: Add `clientShiftId` to `PosShift` in `prisma/schema.prisma`**

In `model PosShift { ... }`, after `cashierId`, add:

```prisma
  clientShiftId  String?
```

And add to the model's block-level attributes (with the existing `@@index` lines):

```prisma
  @@unique([organizationId, clientShiftId])
```

- [ ] **Step 2: Apply the schema (additive) + regen**

Run: `npx prisma db push` then `npm run prisma:generate`
Expected: "in sync", no data loss (a nullable column + a unique index over mostly-null values is additive).

- [ ] **Step 3: Write the failing integration test `lib/__tests__/integration/pos-offline-shift.int.test.ts`**

```typescript
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { openShift, closeShift } from '@/lib/pos/shift';

afterAll(async () => { await disconnect(); });

describe('offline shift idempotency', () => {
  it('openShift is idempotent on clientShiftId (replay returns the same shift)', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId }, select: { id: true } });

    const first = await prisma.$transaction((tx) => openShift(tx, org.orgId, { registerId: register.id, cashierId: 'u1', openingFloat: 100000, clientShiftId: 'cs-1' }));
    const second = await prisma.$transaction((tx) => openShift(tx, org.orgId, { registerId: register.id, cashierId: 'u1', openingFloat: 100000, clientShiftId: 'cs-1' }));

    expect(second.id).toBe(first.id);
    const count = await prisma.posShift.count({ where: { organizationId: org.orgId, clientShiftId: 'cs-1' } });
    expect(count).toBe(1);
    await cleanupOrg(org.orgId);
  });

  it('closeShift is idempotent (second close returns the same result, no throw)', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId }, select: { id: true } });
    const shift = await prisma.$transaction((tx) => openShift(tx, org.orgId, { registerId: register.id, cashierId: 'u1', openingFloat: 100000, clientShiftId: 'cs-2' }));

    const c1 = await prisma.$transaction((tx) => closeShift(tx, org.orgId, { shiftId: shift.id, countedCash: 100000 }));
    const c2 = await prisma.$transaction((tx) => closeShift(tx, org.orgId, { shiftId: shift.id, countedCash: 100000 }));

    expect(c1.status).toBe('CLOSED');
    expect(c2.status).toBe('CLOSED');
    expect(Number(c2.expectedCash)).toBe(Number(c1.expectedCash));
    await cleanupOrg(org.orgId);
  });
});
```

Run `npm run test:int -- pos-offline-shift` — expect FAIL (openShift doesn't accept clientShiftId; closeShift throws on second close).

- [ ] **Step 4: Update `lib/pos/shift.ts`**

Change `OpenShiftInput` and `openShift` to accept/handle `clientShiftId`, and make `closeShift` idempotent. Open the file and:

Add `clientShiftId?: string` to `OpenShiftInput`. Replace the body of `openShift` with:

```typescript
export async function openShift(tx: Prisma.TransactionClient, orgId: string, input: OpenShiftInput): Promise<OpenShiftResult> {
  if (input.clientShiftId) {
    const existing = await tx.posShift.findFirst({ where: { organizationId: orgId, clientShiftId: input.clientShiftId }, select: { id: true } });
    if (existing) return { id: existing.id, status: 'OPEN' };
  }
  const already = await tx.posShift.findFirst({ where: { organizationId: orgId, registerId: input.registerId, status: 'OPEN' }, select: { id: true } });
  if (already) throw new ApiError('Register already has an open shift', 409);
  const shift = await tx.posShift.create({
    data: { organizationId: orgId, registerId: input.registerId, cashierId: input.cashierId, openingFloat: input.openingFloat, clientShiftId: input.clientShiftId ?? null, status: 'OPEN' },
    select: { id: true },
  });
  return { id: shift.id, status: 'OPEN' };
}
```

Make `closeShift` idempotent — replace the guard at the top of `closeShift` (currently throws if not OPEN) with an early return of the stored result when already CLOSED:

```typescript
  const shift = await tx.posShift.findFirst({ where: { id: input.shiftId, organizationId: orgId }, select: { id: true, status: true, openingFloat: true, expectedCash: true, cashVariance: true } });
  if (!shift) throw new ApiError('Shift not found', 404);
  if (shift.status === 'CLOSED') {
    const sales = await tx.posSale.findMany({ where: { organizationId: orgId, shiftId: input.shiftId }, select: { salesInvoice: { select: { totalAmount: true } }, tenders: { select: { method: true, amount: true, changeGiven: true } } } });
    let totalSales = 0, cashCollected = 0;
    for (const s of sales) { totalSales += Number(s.salesInvoice?.totalAmount ?? 0); for (const t of s.tenders) if (t.method === 'CASH') cashCollected += Number(t.amount) - Number(t.changeGiven); }
    return { status: 'CLOSED', expectedCash: Number(shift.expectedCash ?? 0), cashVariance: Number(shift.cashVariance ?? 0), zReport: { totalSales: Math.round((totalSales + Number.EPSILON) * 100) / 100, saleCount: sales.length, cashCollected } };
  }
```

Keep the rest of `closeShift` (the OPEN path) unchanged.

Run `npm run test:int -- pos-offline-shift` — expect PASS.

- [ ] **Step 5: zod + route**

In `types/api.ts`, add `clientShiftId: z.string().trim().optional()` to `openPosShiftSchema`. In `src/app/api/v1/pos/shifts/route.ts` POST handler, pass `clientShiftId: parsed.data.clientShiftId` into `openShift(...)`.

Run `npm run typecheck` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma lib/pos/shift.ts types/api.ts src/app/api/v1/pos/shifts/route.ts lib/__tests__/integration/pos-offline-shift.int.test.ts
git commit -m "feat(pos): idempotent shift open (clientShiftId) + close for offline sync"
```

---

## Task 2: Dependencies + PWA install

**Files:**
- Modify: `package.json` (via npm), `vite.config.js`, `src/pos/main.tsx`
- Create: `public/pos-icon-192.png`, `public/pos-icon-512.png`

- [ ] **Step 1: Install deps**

Run: `npm install dexie` and `npm install -D vite-plugin-pwa`
Expected: both added to `package.json`.

- [ ] **Step 2: Add PWA icons**

Create two simple PNG icons at `public/pos-icon-192.png` (192×192) and `public/pos-icon-512.png` (512×512). Generate solid-color placeholders with the pharmacy cross:

Run:
```bash
node -e "const fs=require('fs'); const png=(size)=>{const {execSync}=require('child_process'); }" 2>/dev/null || true
```
If image generation tooling isn't available, create them from an inline SVG via `sharp` if installed, otherwise copy any existing 512 icon from `public/`. As a guaranteed fallback, write a minimal valid PNG: use `npx --yes @resvg/resvg-js-cli` is NOT required — instead reuse an existing icon: `cp public/favicon*.png public/pos-icon-512.png` if one exists. Verify both files exist and are non-empty (`ls -l public/pos-icon-*.png`). If no source icon exists, generate via node `sharp`:
```bash
node -e "const sharp=require('sharp'); const svg=Buffer.from('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"512\" height=\"512\"><rect width=\"512\" height=\"512\" fill=\"#0f766e\"/><rect x=\"216\" y=\"120\" width=\"80\" height=\"272\" fill=\"#fff\"/><rect x=\"120\" y=\"216\" width=\"272\" height=\"80\" fill=\"#fff\"/></svg>'); sharp(svg).png().toFile('public/pos-icon-512.png').then(()=>sharp(svg).resize(192,192).png().toFile('public/pos-icon-192.png')).then(()=>console.log('icons written'));"
```
(If `sharp` isn't installed, `npm install -D sharp` first.) Confirm `ls -l public/pos-icon-192.png public/pos-icon-512.png` shows two non-empty files.

- [ ] **Step 3: Configure VitePWA in `vite.config.js`**

Add the import and plugin (scoped so it doesn't disturb the back-office entry — the SW is only registered from the pos entry in Step 4):

```js
import { VitePWA } from 'vite-plugin-pwa'
```
Add to the `plugins` array (after `tailwindcss()`):
```js
        VitePWA({
            injectRegister: null,
            registerType: 'autoUpdate',
            filename: 'pos-sw.js',
            manifestFilename: 'pos-manifest.webmanifest',
            manifest: {
                name: 'Pharmacy POS',
                short_name: 'POS',
                start_url: '/pos.html',
                scope: '/',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#0f766e',
                icons: [
                    { src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/pos-icon-512.png', sizes: '512x512', type: 'image/png' },
                ],
            },
            workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
        }),
```

- [ ] **Step 4: Register the service worker only from the POS entry — `src/pos/main.tsx`**

Add near the top (after imports):
```tsx
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });
```
Add a link to the manifest in `pos.html` `<head>`:
```html
    <link rel="manifest" href="/pos-manifest.webmanifest" />
    <meta name="theme-color" content="#0f766e" />
```

- [ ] **Step 5: Verify build produces the SW + manifest, and typecheck**

Run: `npm run build`
Expected: build succeeds; `dist/pos-sw.js` and `dist/pos-manifest.webmanifest` exist (`ls dist/pos-sw.js dist/pos-manifest.webmanifest`). Then `npm run typecheck` — clean (the `virtual:pwa-register` type is provided by the plugin; if TS complains, add `/// <reference types="vite-plugin-pwa/client" />` at the top of `src/pos/main.tsx`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js src/pos/main.tsx pos.html public/pos-icon-192.png public/pos-icon-512.png
git commit -m "feat(pos-app): installable PWA (service worker + manifest) on the POS entry"
```

---

## Task 3: Dexie local store

**Files:**
- Create: `src/pos/offline/db.ts`

- [ ] **Step 1: Implement `src/pos/offline/db.ts`**

```typescript
import Dexie, { type Table } from 'dexie';
import type { CatalogRow, PosRegister } from '../hooks/usePos';
import type { SaleLineInput } from '@/lib/pos/pricing';

export type OutboxType = 'shift-open' | 'sale' | 'shift-close';
export type OutboxStatus = 'pending' | 'synced' | 'failed';

export interface ShiftOpenPayload { clientShiftId: string; registerId: string; openingFloat: number }
export interface SalePayload { clientSaleId: string; clientShiftId: string; registerId: string; shiftId?: string; lines: SaleLineInput[]; tenders: { method: 'CASH'; amount: number }[] }
export interface ShiftClosePayload { clientShiftId: string; shiftId?: string; countedCash: number }

export interface OutboxItem {
  localId: string;
  type: OutboxType;
  clientShiftId: string;
  payload: ShiftOpenPayload | SalePayload | ShiftClosePayload;
  status: OutboxStatus;
  error?: string;
  serverId?: string;
  createdAt: number;
}

export interface ShiftStateRow {
  key: 'current';
  clientShiftId: string;
  serverShiftId?: string;
  registerId: string;
  openingFloat: number;
  status: 'OPEN' | 'CLOSED';
}

export interface CachedCatalog { key: 'current'; rows: CatalogRow[]; fetchedAt: number }
export interface CachedRegisters { key: 'current'; rows: PosRegister[]; fetchedAt: number }

class PosDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  shiftState!: Table<ShiftStateRow, string>;
  catalog!: Table<CachedCatalog, string>;
  registers!: Table<CachedRegisters, string>;

  constructor() {
    super('pharmacy-pos');
    this.version(1).stores({
      outbox: 'localId, status, clientShiftId, createdAt',
      shiftState: 'key',
      catalog: 'key',
      registers: 'key',
    });
  }
}

export const db = new PosDB();
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pos/offline/db.ts
git commit -m "feat(pos-app): add Dexie offline store (catalog, registers, outbox, shiftState)"
```

---

## Task 4: Outbox reducer (pure)

**Files:**
- Create: `src/pos/offline/outbox.ts`
- Test: `src/pos/offline/__tests__/outbox.test.ts`

- [ ] **Step 1: Write the failing test `src/pos/offline/__tests__/outbox.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { enqueue, markSynced, markFailed, rewriteShiftId, pending, exceptions, type OutboxItem } from '../outbox';

const base = (): OutboxItem[] => [];

describe('outbox', () => {
  it('enqueues an item as pending', () => {
    const q = enqueue(base(), { localId: 'a', type: 'shift-open', clientShiftId: 'cs1', payload: { clientShiftId: 'cs1', registerId: 'r1', openingFloat: 0 }, createdAt: 1 });
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe('pending');
  });
  it('marks synced with a serverId', () => {
    let q = enqueue(base(), { localId: 'a', type: 'shift-open', clientShiftId: 'cs1', payload: { clientShiftId: 'cs1', registerId: 'r1', openingFloat: 0 }, createdAt: 1 });
    q = markSynced(q, 'a', 'server-1');
    expect(q[0].status).toBe('synced');
    expect(q[0].serverId).toBe('server-1');
  });
  it('marks failed with an error and lists exceptions', () => {
    let q = enqueue(base(), { localId: 'a', type: 'sale', clientShiftId: 'cs1', payload: { clientSaleId: 'x', clientShiftId: 'cs1', registerId: 'r1', lines: [], tenders: [] }, createdAt: 1 });
    q = markFailed(q, 'a', 'Insufficient batch stock');
    expect(q[0].status).toBe('failed');
    expect(exceptions(q).map((e) => e.error)).toEqual(['Insufficient batch stock']);
  });
  it('rewrites shiftId on pending sales/close for a clientShiftId', () => {
    let q = enqueue(base(), { localId: 's', type: 'sale', clientShiftId: 'cs1', payload: { clientSaleId: 'x', clientShiftId: 'cs1', registerId: 'r1', lines: [], tenders: [] }, createdAt: 2 });
    q = rewriteShiftId(q, 'cs1', 'server-shift-9');
    const p = q[0].payload as { shiftId?: string };
    expect(p.shiftId).toBe('server-shift-9');
  });
  it('pending() returns only pending items in FIFO order', () => {
    let q = base();
    q = enqueue(q, { localId: 'a', type: 'shift-open', clientShiftId: 'cs1', payload: { clientShiftId: 'cs1', registerId: 'r1', openingFloat: 0 }, createdAt: 1 });
    q = enqueue(q, { localId: 'b', type: 'sale', clientShiftId: 'cs1', payload: { clientSaleId: 'x', clientShiftId: 'cs1', registerId: 'r1', lines: [], tenders: [] }, createdAt: 2 });
    q = markSynced(q, 'a', 'srv');
    expect(pending(q).map((i) => i.localId)).toEqual(['b']);
  });
});
```

Run `npm test -- src/pos/offline` — expect FAIL (module missing).

- [ ] **Step 2: Implement `src/pos/offline/outbox.ts`**

```typescript
import type { OutboxItem as DbOutboxItem } from './db';

export type OutboxItem = DbOutboxItem;

export function enqueue(queue: OutboxItem[], item: Omit<OutboxItem, 'status'>): OutboxItem[] {
  return [...queue, { ...item, status: 'pending' }];
}

export function markSynced(queue: OutboxItem[], localId: string, serverId?: string): OutboxItem[] {
  return queue.map((i) => (i.localId === localId ? { ...i, status: 'synced', serverId, error: undefined } : i));
}

export function markFailed(queue: OutboxItem[], localId: string, error: string): OutboxItem[] {
  return queue.map((i) => (i.localId === localId ? { ...i, status: 'failed', error } : i));
}

/** Point pending sales/close ops for a clientShiftId at the now-known server shift id. */
export function rewriteShiftId(queue: OutboxItem[], clientShiftId: string, serverShiftId: string): OutboxItem[] {
  return queue.map((i) => {
    if (i.clientShiftId !== clientShiftId || i.type === 'shift-open') return i;
    return { ...i, payload: { ...(i.payload as Record<string, unknown>), shiftId: serverShiftId } as OutboxItem['payload'] };
  });
}

export function pending(queue: OutboxItem[]): OutboxItem[] {
  return queue.filter((i) => i.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
}

export function exceptions(queue: OutboxItem[]): OutboxItem[] {
  return queue.filter((i) => i.status === 'failed');
}
```

Run `npm test -- src/pos/offline` — expect PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add src/pos/offline/outbox.ts src/pos/offline/__tests__/outbox.test.ts
git commit -m "feat(pos-app): pure outbox reducer for the offline queue"
```

---

## Task 5: Connectivity detector

**Files:**
- Create: `src/pos/offline/connectivity.ts`
- Test: `src/pos/offline/__tests__/connectivity.test.ts`

- [ ] **Step 1: Write the failing test `src/pos/offline/__tests__/connectivity.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { probeOnline } from '../connectivity';

describe('probeOnline', () => {
  it('returns true when the ping resolves ok', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    expect(await probeOnline(ping)).toBe(true);
  });
  it('returns false when the ping throws', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('network'));
    expect(await probeOnline(ping)).toBe(false);
  });
});
```

Run `npm test -- src/pos/offline/__tests__/connectivity` — expect FAIL.

- [ ] **Step 2: Implement `src/pos/offline/connectivity.ts`**

```typescript
import { useEffect, useState } from 'react';

/** Resolve true if the ping succeeds (real connectivity), false otherwise. */
export async function probeOnline(ping: () => Promise<unknown>): Promise<boolean> {
  try { await ping(); return true; } catch { return false; }
}

/** React hook: navigator.onLine + online/offline events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
```

Run `npm test -- src/pos/offline/__tests__/connectivity` — expect PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pos/offline/connectivity.ts src/pos/offline/__tests__/connectivity.test.ts
git commit -m "feat(pos-app): connectivity probe + useOnline hook"
```

---

## Task 6: Sync engine

**Files:**
- Create: `src/pos/offline/sync.ts`
- Test: `src/pos/offline/__tests__/sync.test.ts`

The engine is pure over an injected `poster` (so it's unit-testable without a network or Dexie): it takes a queue, drains it in order, and returns the updated queue.

- [ ] **Step 1: Write the failing test `src/pos/offline/__tests__/sync.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { syncQueue, type Poster } from '../sync';
import { enqueue, type OutboxItem } from '../outbox';

function build(): OutboxItem[] {
  let q: OutboxItem[] = [];
  q = enqueue(q, { localId: 'open', type: 'shift-open', clientShiftId: 'cs1', payload: { clientShiftId: 'cs1', registerId: 'r1', openingFloat: 100 }, createdAt: 1 });
  q = enqueue(q, { localId: 'sale', type: 'sale', clientShiftId: 'cs1', payload: { clientSaleId: 'sale-1', clientShiftId: 'cs1', registerId: 'r1', lines: [], tenders: [{ method: 'CASH', amount: 100 }] }, createdAt: 2 });
  q = enqueue(q, { localId: 'close', type: 'shift-close', clientShiftId: 'cs1', payload: { clientShiftId: 'cs1', countedCash: 100 }, createdAt: 3 });
  return q;
}

describe('syncQueue', () => {
  it('drains open→sale→close in order, rewriting the shift id, all synced', async () => {
    const poster: Poster = {
      openShift: vi.fn().mockResolvedValue({ id: 'server-shift-1' }),
      sale: vi.fn().mockResolvedValue({ posSaleId: 'ps1' }),
      closeShift: vi.fn().mockResolvedValue({ status: 'CLOSED' }),
    };
    const out = await syncQueue(build(), poster);
    expect(out.every((i) => i.status === 'synced')).toBe(true);
    // sale posted with the resolved server shift id
    expect((poster.sale as any).mock.calls[0][0].shiftId).toBe('server-shift-1');
    expect((poster.closeShift as any).mock.calls[0][0]).toBe('server-shift-1');
  });

  it('marks a business-rejected sale failed and continues', async () => {
    const poster: Poster = {
      openShift: vi.fn().mockResolvedValue({ id: 'server-shift-1' }),
      sale: vi.fn().mockRejectedValue(Object.assign(new Error('Insufficient batch stock'), { status: 400 })),
      closeShift: vi.fn().mockResolvedValue({ status: 'CLOSED' }),
    };
    const out = await syncQueue(build(), poster);
    expect(out.find((i) => i.localId === 'sale')?.status).toBe('failed');
    expect(out.find((i) => i.localId === 'close')?.status).toBe('synced');
  });

  it('leaves an op pending on a network error (no status)', async () => {
    const poster: Poster = {
      openShift: vi.fn().mockRejectedValue(new Error('offline')),
      sale: vi.fn(), closeShift: vi.fn(),
    };
    const out = await syncQueue(build(), poster);
    expect(out.find((i) => i.localId === 'open')?.status).toBe('pending');
    expect(poster.sale).not.toHaveBeenCalled();
  });
});
```

Run `npm test -- src/pos/offline/__tests__/sync` — expect FAIL.

- [ ] **Step 2: Implement `src/pos/offline/sync.ts`**

```typescript
import { pending, markSynced, markFailed, rewriteShiftId, type OutboxItem } from './outbox';
import type { ShiftOpenPayload, SalePayload, ShiftClosePayload } from './db';

export interface Poster {
  openShift: (p: { registerId: string; openingFloat: number; clientShiftId: string }) => Promise<{ id: string }>;
  sale: (p: { clientSaleId: string; registerId: string; shiftId: string; lines: unknown[]; tenders: { method: 'CASH'; amount: number }[] }) => Promise<unknown>;
  closeShift: (shiftId: string, p: { countedCash: number }) => Promise<unknown>;
}

/** Drain the queue in FIFO order. Returns the updated queue. A no-status (network) error stops the drain (leaves pending); a business error (has .status) marks that op failed and continues. */
export async function syncQueue(queue: OutboxItem[], poster: Poster): Promise<OutboxItem[]> {
  let q = queue;
  for (const item of pending(q)) {
    try {
      if (item.type === 'shift-open') {
        const p = item.payload as ShiftOpenPayload;
        const res = await poster.openShift({ registerId: p.registerId, openingFloat: p.openingFloat, clientShiftId: p.clientShiftId });
        q = rewriteShiftId(q, item.clientShiftId, res.id);
        q = markSynced(q, item.localId, res.id);
      } else if (item.type === 'sale') {
        const p = item.payload as SalePayload;
        if (!p.shiftId) throw Object.assign(new Error('Shift not yet synced'), { status: 409 });
        await poster.sale({ clientSaleId: p.clientSaleId, registerId: p.registerId, shiftId: p.shiftId, lines: p.lines, tenders: p.tenders });
        q = markSynced(q, item.localId);
      } else {
        const p = item.payload as ShiftClosePayload;
        if (!p.shiftId) throw Object.assign(new Error('Shift not yet synced'), { status: 409 });
        await poster.closeShift(p.shiftId, { countedCash: p.countedCash });
        q = markSynced(q, item.localId);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === undefined) return q; // network error → stop, keep pending, retry later
      q = markFailed(q, item.localId, (err as Error).message);
    }
  }
  return q;
}
```

Run `npm test -- src/pos/offline/__tests__/sync` — expect PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/pos/offline/sync.ts src/pos/offline/__tests__/sync.test.ts
git commit -m "feat(pos-app): ordered idempotent sync engine (pure, injectable poster)"
```

---

## Task 7: Offline-aware operations + wiring

**Files:**
- Create: `src/pos/hooks/useOfflinePos.ts`
- Modify: `src/pos/PosApp.tsx`, `src/pos/views/ShiftOpenView.tsx`, `src/pos/views/CheckoutView.tsx`, `src/pos/views/ShiftCloseView.tsx`

- [ ] **Step 1: Implement `src/pos/hooks/useOfflinePos.ts`**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/src/api/apiClient';
import { db, type OutboxItem } from '../offline/db';
import { enqueue, pending, exceptions } from '../offline/outbox';
import { syncQueue, type Poster } from '../offline/sync';
import { useOnline } from '../offline/connectivity';

function uuid(): string { return (crypto as Crypto).randomUUID(); }

const poster: Poster = {
  openShift: (p) => api.post<{ id: string }>('/api/v1/pos/shifts', p),
  sale: (p) => api.post('/api/v1/pos/sales', p),
  closeShift: (shiftId, p) => api.post(`/api/v1/pos/shifts/${shiftId}/close`, p),
};

async function loadQueue(): Promise<OutboxItem[]> { return db.outbox.orderBy('createdAt').toArray(); }
async function saveQueue(q: OutboxItem[]): Promise<void> { await db.transaction('rw', db.outbox, async () => { await db.outbox.clear(); await db.outbox.bulkAdd(q); }); }

/** Enqueue an op locally, then attempt a sync if online. Returns nothing (fire-and-forget UI updates via refreshCounts). */
export function useOfflineSync() {
  const online = useOnline();
  const [pendingCount, setPendingCount] = useState(0);
  const [exceptionCount, setExceptionCount] = useState(0);

  const refresh = useCallback(async () => {
    const q = await loadQueue();
    setPendingCount(pending(q).length);
    setExceptionCount(exceptions(q).length);
  }, []);

  const sync = useCallback(async () => {
    const q = await loadQueue();
    if (pending(q).length === 0) return;
    const next = await syncQueue(q, poster);
    await saveQueue(next);
    await refresh();
  }, [refresh]);

  const enqueueOp = useCallback(async (item: Omit<OutboxItem, 'status'>) => {
    const q = enqueue(await loadQueue(), item);
    await saveQueue(q);
    await refresh();
    if (online) void sync();
  }, [online, sync, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (online) void sync(); }, [online, sync]);
  useEffect(() => {
    const onFocus = () => { if (navigator.onLine) void sync(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [sync]);

  return { online, pendingCount, exceptionCount, sync, enqueueOp, uuid };
}

/** Cache the catalog + registers whenever we successfully fetch them online. */
export async function cacheCatalog(rows: unknown[]): Promise<void> { await db.catalog.put({ key: 'current', rows: rows as never, fetchedAt: Date.now() }); }
export async function readCachedCatalog() { return (await db.catalog.get('current'))?.rows ?? []; }
```

- [ ] **Step 2: Wire offline shift-open/sale/close into the views**

This step threads the offline queue into the existing flow. The key changes (apply carefully, preserving existing behavior when online):
- `ShiftOpenView`: generate a `clientShiftId = uuid()`. On "Buka shift", `enqueueOp({ localId: uuid(), type: 'shift-open', clientShiftId, payload: { clientShiftId, registerId, openingFloat } })`, persist `shiftState` (`db.shiftState.put({ key:'current', clientShiftId, registerId, openingFloat, status:'OPEN' })`), and call `onOpened(clientShiftId, registerId)` immediately (optimistic — works offline). When online the enqueue triggers a sync that creates the server shift.
- `CheckoutView`: the sale's `shiftId` is the `clientShiftId` (from shiftState). On pay, `enqueueOp({ localId: uuid(), type: 'sale', clientShiftId, payload: { clientSaleId: saleId, clientShiftId, registerId, lines: toSaleLines(cart), tenders: [{method:'CASH', amount: cash}] } })`, then show the receipt from local data (do not wait for the server). Keep the existing online post ONLY through the queue path (so offline and online share one path).
- `ShiftCloseView`: `enqueueOp({ type: 'shift-close', clientShiftId, payload: { clientShiftId, countedCash } })`; compute the Z-report locally from the outbox sales for display; clear `shiftState`.
- `PosApp`: on load, read `db.shiftState`; if an OPEN shift exists, resume into checkout using its `clientShiftId` (so an offline reload resumes).

Follow the existing view structure; the goal is that every shift/sale/close goes through `enqueueOp`, giving one code path for online and offline. Keep the redesigned UI intact.

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck` then `npm run build`. Both must pass (both entries build; `dist/pos-sw.js` present).

- [ ] **Step 4: Commit**

```bash
git add src/pos/hooks/useOfflinePos.ts src/pos/PosApp.tsx src/pos/views/ShiftOpenView.tsx src/pos/views/CheckoutView.tsx src/pos/views/ShiftCloseView.tsx
git commit -m "feat(pos-app): route shift/sale/close through the offline queue with auto-sync"
```

---

## Task 8: OfflineBar + Exceptions view

**Files:**
- Create: `src/pos/components/OfflineBar.tsx`, `src/pos/views/ExceptionsView.tsx`
- Modify: `src/pos/components/StatusBar.tsx` (embed OfflineBar), `src/pos/i18n/strings.ts` (labels)

- [ ] **Step 1: Add i18n keys to `src/pos/i18n/strings.ts`**

```typescript
  'offline.online':   { id: 'Online',              en: 'Online' },
  'offline.offline':  { id: 'Offline',             en: 'Offline' },
  'offline.queued':   { id: 'antre',               en: 'queued' },
  'offline.sync':     { id: 'Sinkronkan',          en: 'Sync now' },
  'offline.exceptions': { id: 'Perlu ditinjau',    en: 'Needs review' },
```

- [ ] **Step 2: Implement `src/pos/components/OfflineBar.tsx`**

```tsx
import React from 'react';
import Button from '@/src/components/UI/Button';
import { t } from '../i18n/strings';

export default function OfflineBar({ online, pendingCount, exceptionCount, onSync }: { online: boolean; pendingCount: number; exceptionCount: number; onSync: () => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${online ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-amber-500'}`} />
        {online ? t('offline.online') : t('offline.offline')}
      </span>
      {pendingCount > 0 && <span className="text-gray-500">{pendingCount} {t('offline.queued')}</span>}
      {exceptionCount > 0 && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">{exceptionCount} {t('offline.exceptions')}</span>}
      <Button variant="ghost" size="sm" text={t('offline.sync')} disabled={!online || pendingCount === 0} onClick={onSync} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/pos/views/ExceptionsView.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { db, type OutboxItem } from '../offline/db';
import { exceptions } from '../offline/outbox';

export default function ExceptionsView(): React.ReactElement {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => { void db.outbox.orderBy('createdAt').toArray().then((q) => setItems(exceptions(q))); }, []);
  if (items.length === 0) return <p className="p-8 text-center text-gray-400">—</p>;
  return (
    <ul className="divide-y">
      {items.map((i) => (
        <li key={i.localId} className="flex justify-between px-4 py-3 text-sm">
          <span>{i.type} · {i.clientShiftId.slice(-6)}</span>
          <span className="text-red-600">{i.error}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Embed OfflineBar in `StatusBar.tsx`**

Import `OfflineBar` and the `useOfflineSync` hook; render `<OfflineBar ... />` in the status bar's right group, passing `online/pendingCount/exceptionCount/onSync` (either lift the hook to `PosApp` and pass down, or call the hook in `StatusBar`). Keep the existing store/cashier/clock/logout/close.

- [ ] **Step 5: Verify typecheck + build; commit**

Run: `npm run typecheck` then `npm run build`. Then:
```bash
git add src/pos/components/OfflineBar.tsx src/pos/views/ExceptionsView.tsx src/pos/components/StatusBar.tsx src/pos/i18n/strings.ts
git commit -m "feat(pos-app): offline/queue indicator + Sync now + Exceptions list"
```

---

## Task 9: E2E offline test + final regression

**Files:**
- Create: `e2e/pos-offline.spec.ts`

- [ ] **Step 1: Write `e2e/pos-offline.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

// Prereqs: dev DB seeded (POS Operator role incl. POS_RETAIL, WALK-IN, REG-1) + a stocked
// batch item; `npm run dev` (:5173) + `npm run backend:dev` (:3000). Runs manually, not in unit CI.
test.describe('POS offline', () => {
  test('open shift + cash sale offline, then sync on reconnect', async ({ page, context }) => {
    await page.goto('/pos.html');
    await page.fill('input[type="email"]', 'cashier@demo.com');
    await page.fill('input[type="password"]', 'cashier123');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Buka shift')).toBeVisible();

    await context.setOffline(true);
    await page.fill('input[type="number"]', '100000');
    await page.getByRole('button', { name: 'Buka shift' }).click();
    await page.getByPlaceholder('Pindai / cari barang').fill('Paracetamol');
    await page.getByRole('button', { name: /Paracetamol/ }).first().click();
    await page.getByRole('button', { name: /Bayar/ }).click();
    await page.getByLabel('Uang diterima').fill('50000');
    await page.getByRole('button', { name: 'Selesaikan' }).click();
    await expect(page.getByText('Kembalian')).toBeVisible(); // receipt printed locally, offline

    await context.setOffline(false);
    await expect(page.getByText('Online')).toBeVisible();
    // queue drains; the "queued" badge returns to zero
    await expect(page.getByText(/antre/)).toHaveCount(0, { timeout: 15000 });
  });
});
```

- [ ] **Step 2: Full regression (CI-runnable gates)**

Run each:
- `npm test` — all unit tests pass (existing + new offline: outbox, connectivity, sync).
- `npm run test:int` — all integration pass (incl. `pos-offline-shift`).
- `npm run typecheck` — clean.
- `npm run build` — both entries build; `dist/pos-sw.js` + `dist/pos-manifest.webmanifest` present.

Confirm the back-office entry is unaffected.

- [ ] **Step 3: Commit**

```bash
git add e2e/pos-offline.spec.ts
git commit -m "test(pos-app): offline -> reconnect e2e"
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** installable PWA + SW (Task 2) ✓; Dexie stores (Task 3) ✓; outbox queue (Task 4) ✓; connectivity (Task 5) ✓; ordered idempotent sync (Task 6) ✓; offline shift/sale/close wiring + resume (Task 7) ✓; OfflineBar + Exceptions (Task 8) ✓; backend `clientShiftId` idempotent open + idempotent close (Task 1) ✓; e2e offline→reconnect (Task 9) ✓. Conflicts → Exceptions (Tasks 6 markFailed + 8) ✓; auto + manual sync (Task 7 effects + Task 8 button) ✓. Out-of-scope items absent.
- **Placeholder scan:** none — every step has real code/commands. Task 2 Step 2 (icons) gives a concrete sharp-based generator + fallback; Task 7 Step 2 is a wiring step with explicit per-view instructions and the exact enqueue payloads (it composes already-defined functions, not new types).
- **Type consistency:** `OutboxItem`, `OutboxType`, `ShiftOpenPayload`/`SalePayload`/`ShiftClosePayload`, `Poster`, `enqueue/markSynced/markFailed/rewriteShiftId/pending/exceptions`, `syncQueue`, `useOfflineSync` names are used identically across db.ts, outbox.ts, sync.ts, and the hooks/components. `clientShiftId` threads through backend (Task 1) and client (Tasks 3–7).
- **Known verification points (flagged inline):** (a) `virtual:pwa-register` type ref may need the client types reference (Task 2 Step 5 notes it); (b) VitePWA on a multi-entry Vite build precaches all assets — acceptable; (c) the PWA-icon generation has a documented fallback if `sharp` isn't present.

---

## Follow-on (later slices)
Non-cash tenders offline, two-way stock pull, dispensing/Rx, QRIS aggregator, SATUSEHAT — separate slices.
```
