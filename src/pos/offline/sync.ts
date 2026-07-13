import { pending, markSynced, markFailed, rewriteShiftId, type OutboxItem } from './outbox';
import type { ShiftOpenPayload, SalePayload, ShiftClosePayload } from './db';

export interface Poster {
  openShift: (p: { registerId: string; openingFloat: number; clientShiftId: string }) => Promise<{ id: string }>;
  sale: (p: { clientSaleId: string; registerId: string; shiftId: string; salesTypeId?: string | null; lines: unknown[]; tenders: { method: 'CASH'; amount: number }[] }) => Promise<unknown>;
  closeShift: (shiftId: string, p: { countedCash: number }) => Promise<unknown>;
}

/**
 * Drain the queue in FIFO order. Returns the updated queue. A no-status (network)
 * error stops the drain (leaves the op pending for the next trigger); a business
 * error (has `.status`) marks that op failed and continues.
 */
export async function syncQueue(queue: OutboxItem[], poster: Poster): Promise<OutboxItem[]> {
  let q = queue;
  const order = pending(q).map((i) => i.localId); // FIFO order to process
  for (const localId of order) {
    const item = q.find((i) => i.localId === localId); // re-read: earlier ops (e.g. shift-open) rewrite later items
    if (!item || item.status !== 'pending') continue;
    try {
      if (item.type === 'shift-open') {
        const p = item.payload as ShiftOpenPayload;
        const res = await poster.openShift({ registerId: p.registerId, openingFloat: p.openingFloat, clientShiftId: p.clientShiftId });
        q = rewriteShiftId(q, item.clientShiftId, res.id);
        q = markSynced(q, item.localId, res.id);
      } else if (item.type === 'sale') {
        const p = item.payload as SalePayload;
        if (!p.shiftId) throw Object.assign(new Error('Shift not yet synced'), { status: 409 });
        await poster.sale({ clientSaleId: p.clientSaleId, registerId: p.registerId, shiftId: p.shiftId, salesTypeId: p.salesTypeId, lines: p.lines, tenders: p.tenders });
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
