import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => undefined) } } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/bill-void', () => ({ voidBill: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidBill } from '@/lib/bill-void';
import { ApiError } from '@/lib/errors';
import { POST as voidRoute } from '../bills/[id]/void/route';

function req() {
  return new NextRequest('http://localhost/api/v1/bills/bill-1/void', {
    method: 'POST',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' },
  });
}

beforeEach(() => vi.clearAllMocks());

it('voids the bill and returns it', async () => {
  const tx = { bill: { findFirst: vi.fn(async () => ({ id: 'bill-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await voidRoute(req(), { params: Promise.resolve({ id: 'bill-1' }) });
  expect(res.status).toBe(200);
  expect(voidBill).toHaveBeenCalledWith(tx, 'org-a', 'bill-1', expect.objectContaining({ date: expect.any(Date) }));
  const body = await res.json();
  expect(body.status).toBe('VOID');
});

it('maps a guard failure to its status code', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
    const tx = { bill: { findFirst: vi.fn() } };
    return cb(tx);
  });
  vi.mocked(voidBill).mockRejectedValueOnce(new ApiError('Cannot void a paid bill', 422));

  const res = await voidRoute(req(), { params: Promise.resolve({ id: 'bill-1' }) });
  expect(res.status).toBe(422);
});
