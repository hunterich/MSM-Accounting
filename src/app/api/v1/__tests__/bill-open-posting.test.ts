import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bill: {},
    auditLog: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/bill-posting', () => ({ postBillToLedger: vi.fn(async () => undefined) }));

import { prisma } from '@/lib/prisma';
import { postBillToLedger } from '@/lib/bill-posting';
import { PUT as putBill } from '../bills/[id]/route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/bills/bill-1', {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

it('posts to the ledger when a DRAFT bill transitions to OPEN', async () => {
  const tx = {
    bill: {
      findFirst: vi.fn()
        .mockResolvedValueOnce({ id: 'bill-1', status: 'DRAFT' })            // existing
        .mockResolvedValueOnce({ id: 'bill-1', lines: [] })                  // finalized (for posting)
        .mockResolvedValueOnce({ id: 'bill-1', status: 'OPEN', lines: [] }), // return value
      update: vi.fn(async () => ({})),
    },
    billLine: { deleteMany: vi.fn(), createMany: vi.fn() },
    vendor: { findFirst: vi.fn() },
    purchaseOrder: { findFirst: vi.fn() },
  };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await putBill(req({ status: 'OPEN' }), { params: Promise.resolve({ id: 'bill-1' }) });
  expect(res.status).toBe(200);
  expect(postBillToLedger).toHaveBeenCalledTimes(1);
});
