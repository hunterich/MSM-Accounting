/**
 * PO numbering — "Auto" lets the server allocate PO-####, "Manual" keeps the
 * typed number and rejects one already used in the organization.
 *
 * Prisma is fully mocked so no database is required.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const tx = {
  purchaseOrder: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  purchaseOrderLine: { createMany: vi.fn() },
  purchaseOrderCharge: { createMany: vi.fn() },
  vendor: { findFirst: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (t: unknown) => Promise<unknown>) => callback(tx)),
  },
}));

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    logAudit: vi.fn(),
    nextNumber: vi.fn(async () => 'PO-0007'),
    validateForeignKey: vi.fn(async () => undefined),
  };
});

import { POST as createPO } from '../purchase-orders/route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/purchase-orders', {
    method: 'POST',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as any);
}

const basePayload = {
  vendorId: 'vendor-1',
  date: '2026-09-28',
  lines: [{ description: 'Kemiri oil', quantity: 10, price: 9000, unit: 'PCS' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({ id: 'po-1', number: data.number }));
  tx.purchaseOrder.findUnique.mockImplementation(async () => ({ id: 'po-1', number: tx.purchaseOrder.create.mock.calls[0]?.[0]?.data?.number }));
  tx.purchaseOrder.findFirst.mockResolvedValue(null);
});

describe('POST /api/v1/purchase-orders — numbering', () => {
  it('allocates the next PO number when none is given', async () => {
    const res = await createPO(makeReq(basePayload));
    expect(res.status).toBe(201);
    expect(tx.purchaseOrder.create.mock.calls[0][0].data.number).toBe('PO-0007');
  });

  it('keeps a manual PO number', async () => {
    const res = await createPO(makeReq({ ...basePayload, number: '  PO-TC-0001 ' }));
    expect(res.status).toBe(201);
    expect(tx.purchaseOrder.create.mock.calls[0][0].data.number).toBe('PO-TC-0001');
  });

  it('rejects a manual PO number already used in the organization', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-old' });
    const res = await createPO(makeReq({ ...basePayload, number: 'PO-TC-0001' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('PO-TC-0001') });
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });
});
