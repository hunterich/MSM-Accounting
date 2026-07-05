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
