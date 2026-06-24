import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => undefined) } } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/invoice-void', () => ({ voidInvoice: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidInvoice } from '@/lib/invoice-void';
import { ApiError } from '@/lib/errors';
import { POST as voidRoute } from '../invoices/[id]/void/route';
import { PUT as putInvoice } from '../invoices/[id]/route';

const params = { params: Promise.resolve({ id: 'inv-1' }) };
function post() {
  return new NextRequest('http://localhost/api/v1/invoices/inv-1/void', { method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1' } });
}
function putVoid() {
  return new NextRequest('http://localhost/api/v1/invoices/inv-1', {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'VOID' }),
  });
}

beforeEach(() => vi.clearAllMocks());

it('void route reverses and returns the invoice', async () => {
  const tx = { salesInvoice: { findFirst: vi.fn(async () => ({ id: 'inv-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(200);
  expect(voidInvoice).toHaveBeenCalledWith(tx, 'org-a', 'inv-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ salesInvoice: { findFirst: vi.fn() } }));
  vi.mocked(voidInvoice).mockRejectedValueOnce(new ApiError('Cannot void a paid invoice', 422));
  const res = await voidRoute(post(), params);
  expect(res.status).toBe(422);
});

it('PUT status:VOID is rejected (422) and does not run the transaction', async () => {
  const res = await putInvoice(putVoid(), params);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
