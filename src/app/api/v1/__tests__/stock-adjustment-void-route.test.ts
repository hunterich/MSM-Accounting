import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: { create: vi.fn(async () => undefined) },
    stockAdjustment: { findFirst: vi.fn(), delete: vi.fn() },
    inventoryLedgerEntry: { count: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/stock-adjustment-void', () => ({ voidStockAdjustment: vi.fn() }));
vi.mock('@/lib/stock-count-void', () => ({ voidStockCountForAdjustment: vi.fn(async () => null) }));

import { prisma } from '@/lib/prisma';
import { voidStockAdjustment } from '@/lib/stock-adjustment-void';
import { voidStockCountForAdjustment } from '@/lib/stock-count-void';
import { ApiError } from '@/lib/errors';
import { POST as voidRoute } from '../stock-adjustments/[id]/void/route';
import { DELETE as deleteAdj } from '../stock-adjustments/[id]/route';

const params = { params: Promise.resolve({ id: 'adj-1' }) };
function post() {
  return new NextRequest('http://localhost/api/v1/stock-adjustments/adj-1/void', { method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' } });
}
function del() {
  return new NextRequest('http://localhost/api/v1/stock-adjustments/adj-1', { method: 'DELETE', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' } });
}

beforeEach(() => vi.clearAllMocks());

it('void route reverses and returns the adjustment', async () => {
  const tx = { stockAdjustment: { findFirst: vi.fn(async () => ({ id: 'adj-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(200);
  expect(voidStockAdjustment).toHaveBeenCalledWith(tx, 'org-a', 'adj-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('void route cascades to the owning stock count in the same transaction', async () => {
  const tx = { stockAdjustment: { findFirst: vi.fn(async () => ({ id: 'adj-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  await voidRoute(post(), params);
  expect(voidStockCountForAdjustment).toHaveBeenCalledWith(tx, 'org-a', 'adj-1');
  // cascade runs only after the adjustment itself is voided
  expect(vi.mocked(voidStockAdjustment).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(voidStockCountForAdjustment).mock.invocationCallOrder[0]);
});

it('void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ stockAdjustment: { findFirst: vi.fn() } }));
  vi.mocked(voidStockAdjustment).mockRejectedValueOnce(new ApiError('Stock adjustment is already voided', 422));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(422);
});

it('DELETE refuses a DRAFT adjustment that already posted inventory (would orphan it)', async () => {
  vi.mocked(prisma.stockAdjustment.findFirst).mockResolvedValueOnce({ id: 'adj-1', status: 'DRAFT' } as any);
  vi.mocked(prisma.inventoryLedgerEntry.count).mockResolvedValueOnce(2 as any);
  const res = await deleteAdj(del(), params);
  expect(res.status).toBe(422);
  expect(prisma.stockAdjustment.delete).not.toHaveBeenCalled();
});

it('DELETE removes an unposted DRAFT adjustment', async () => {
  vi.mocked(prisma.stockAdjustment.findFirst).mockResolvedValueOnce({ id: 'adj-1', status: 'DRAFT' } as any);
  vi.mocked(prisma.inventoryLedgerEntry.count).mockResolvedValueOnce(0 as any);
  vi.mocked(prisma.stockAdjustment.delete).mockResolvedValueOnce({} as any);
  const res = await deleteAdj(del(), params);
  expect(res.status).toBe(200);
  expect(prisma.stockAdjustment.delete).toHaveBeenCalled();
});
