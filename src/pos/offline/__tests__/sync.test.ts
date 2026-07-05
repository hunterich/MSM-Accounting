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
    expect((poster.sale as ReturnType<typeof vi.fn>).mock.calls[0][0].shiftId).toBe('server-shift-1');
    expect((poster.closeShift as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('server-shift-1');
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
