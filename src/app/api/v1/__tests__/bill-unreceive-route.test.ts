import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => undefined) } } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/unreceive-goods', () => ({ unreceiveGoodsReceipt: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { unreceiveGoodsReceipt } from '@/lib/unreceive-goods';
import { ApiError } from '@/lib/errors';
import { POST as unreceive } from '../bills/[id]/unreceive/route';

function req() {
  return new NextRequest('http://localhost/api/v1/bills/bill-1/unreceive', {
    method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' },
  });
}
const params = { params: Promise.resolve({ id: 'bill-1' }) };

beforeEach(() => vi.clearAllMocks());

it('un-receives and returns success', async () => {
  const tx = {};
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  const res = await unreceive(req(), params);
  expect(res.status).toBe(200);
  expect(unreceiveGoodsReceipt).toHaveBeenCalledWith(tx, 'org-a', 'bill-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({}));
  vi.mocked(unreceiveGoodsReceipt).mockRejectedValueOnce(new ApiError('Only a draft goods receipt can be un-received — void the bill first', 422));
  const res = await unreceive(req(), params);
  expect(res.status).toBe(422);
});
