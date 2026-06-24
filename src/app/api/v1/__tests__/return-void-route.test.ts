import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => undefined) } } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/return-void', () => ({ voidSalesReturn: vi.fn(), voidPurchaseReturn: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidSalesReturn, voidPurchaseReturn } from '@/lib/return-void';
import { ApiError } from '@/lib/errors';
import { POST as voidSales } from '../sales-returns/[id]/void/route';
import { POST as voidPurchase } from '../purchase-returns/[id]/void/route';
import { PUT as putSales } from '../sales-returns/[id]/route';
import { PUT as putPurchase } from '../purchase-returns/[id]/route';

const srParams = { params: Promise.resolve({ id: 'sr-1' }) };
const prParams = { params: Promise.resolve({ id: 'pr-1' }) };
function post(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1' } });
}
function putVoid(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'VOID' }),
  });
}

beforeEach(() => vi.clearAllMocks());

it('sales-return void route reverses and returns the record', async () => {
  const tx = { salesReturn: { findFirst: vi.fn(async () => ({ id: 'sr-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  const res = await voidSales(post('/api/v1/sales-returns/sr-1/void'), srParams);
  expect(res.status).toBe(200);
  expect(voidSalesReturn).toHaveBeenCalledWith(tx, 'org-a', 'sr-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('sales-return void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ salesReturn: { findFirst: vi.fn() } }));
  vi.mocked(voidSalesReturn).mockRejectedValueOnce(new ApiError('sales return is already voided', 422));
  const res = await voidSales(post('/api/v1/sales-returns/sr-1/void'), srParams);
  expect(res.status).toBe(422);
});

it('purchase-return void route reverses and returns the record', async () => {
  const tx = { purchaseReturn: { findFirst: vi.fn(async () => ({ id: 'pr-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  const res = await voidPurchase(post('/api/v1/purchase-returns/pr-1/void'), prParams);
  expect(res.status).toBe(200);
  expect(voidPurchaseReturn).toHaveBeenCalledWith(tx, 'org-a', 'pr-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('PUT status:VOID is rejected on a sales return (422, no transaction)', async () => {
  const res = await putSales(putVoid('/api/v1/sales-returns/sr-1'), srParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('PUT status:VOID is rejected on a purchase return (422, no transaction)', async () => {
  const res = await putPurchase(putVoid('/api/v1/purchase-returns/pr-1'), prParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
