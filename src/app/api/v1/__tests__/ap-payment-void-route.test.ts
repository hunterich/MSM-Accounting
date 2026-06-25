import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: { create: vi.fn(async () => undefined) },
    aPPayment: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/payment-void', () => ({ voidApPayment: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidApPayment } from '@/lib/payment-void';
import { ApiError } from '@/lib/errors';
import { POST as voidRoute } from '../ap-payments/[id]/void/route';
import { DELETE as deletePayment } from '../ap-payments/[id]/route';

function post() {
  return new NextRequest('http://localhost/api/v1/ap-payments/pay-1/void', {
    method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' },
  });
}
function del() {
  return new NextRequest('http://localhost/api/v1/ap-payments/pay-1', {
    method: 'DELETE', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' },
  });
}
const params = { params: Promise.resolve({ id: 'pay-1' }) };

beforeEach(() => vi.clearAllMocks());

it('void route reverses and returns the payment', async () => {
  const tx = { aPPayment: { findFirst: vi.fn(async () => ({ id: 'pay-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await voidRoute(post(), params);
  expect(res.status).toBe(200);
  expect(voidApPayment).toHaveBeenCalledWith(tx, 'org-a', 'pay-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ aPPayment: { findFirst: vi.fn() } }));
  vi.mocked(voidApPayment).mockRejectedValueOnce(new ApiError('AP payment is already voided', 422));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(422);
});

it('DELETE refuses a posted payment (would orphan its JE)', async () => {
  vi.mocked(prisma.aPPayment.findFirst).mockResolvedValueOnce({ id: 'pay-1', journalEntryId: 'je-1' } as any);
  const res = await deletePayment(del(), params);
  expect(res.status).toBe(422);
  expect(prisma.aPPayment.delete).not.toHaveBeenCalled();
});

it('DELETE removes an unposted (draft) payment', async () => {
  vi.mocked(prisma.aPPayment.findFirst).mockResolvedValueOnce({ id: 'pay-1', journalEntryId: null } as any);
  vi.mocked(prisma.aPPayment.delete).mockResolvedValueOnce({} as any);
  const res = await deletePayment(del(), params);
  expect(res.status).toBe(200);
  expect(prisma.aPPayment.delete).toHaveBeenCalled();
});
