import { useCallback, useEffect, useState } from 'react';
import { api } from '@/src/api/apiClient';
import { db, type OutboxItem } from '../offline/db';
import { enqueue, pending, exceptions } from '../offline/outbox';
import { syncQueue, type Poster } from '../offline/sync';
import { useOnline } from '../offline/connectivity';
import type { CatalogRow } from './usePos';

export function uuid(): string { return (crypto as Crypto).randomUUID(); }

const poster: Poster = {
  openShift: (p) => api.post<{ id: string }>('/api/v1/pos/shifts', p),
  sale: (p) => api.post('/api/v1/pos/sales', p),
  closeShift: (shiftId, p) => api.post(`/api/v1/pos/shifts/${shiftId}/close`, p),
};

async function loadQueue(): Promise<OutboxItem[]> { return db.outbox.orderBy('createdAt').toArray(); }
async function saveQueue(q: OutboxItem[]): Promise<void> {
  await db.transaction('rw', db.outbox, async () => { await db.outbox.clear(); if (q.length) await db.outbox.bulkAdd(q); });
}

/** Cache the catalog whenever we successfully fetch it online, so the grid works offline. */
export async function cacheCatalog(rows: CatalogRow[]): Promise<void> { await db.catalog.put({ key: 'current', rows, fetchedAt: Date.now() }); }
export async function readCachedCatalog(): Promise<CatalogRow[]> { return (await db.catalog.get('current'))?.rows ?? []; }

/** Offline queue state + operations. Enqueue locally; auto-sync when online. */
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
    if (typeof navigator !== 'undefined' && navigator.onLine) void sync();
  }, [sync, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (online) void sync(); }, [online, sync]);
  useEffect(() => {
    const onFocus = () => { if (navigator.onLine) void sync(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [sync]);

  return { online, pendingCount, exceptionCount, sync, enqueueOp };
}
