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
    return { ...i, payload: { ...(i.payload as unknown as Record<string, unknown>), shiftId: serverShiftId } as OutboxItem['payload'] };
  });
}

export function pending(queue: OutboxItem[]): OutboxItem[] {
  return queue.filter((i) => i.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
}

export function exceptions(queue: OutboxItem[]): OutboxItem[] {
  return queue.filter((i) => i.status === 'failed');
}
