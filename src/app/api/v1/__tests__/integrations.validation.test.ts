import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    customer: {
      findFirst: vi.fn(),
    },
    bankAccount: {
      findFirst: vi.fn(),
    },
    ecommerceConnection: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  return { prisma };
});

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError,
    ok: (data: unknown, status = 200) => Response.json(data, { status }),
    err: (msg: string, status: number) => Response.json({ error: msg }, { status }),
    listResponse: (data: unknown, total: number, page: number, limit: number) =>
      Response.json({ data, total, page, limit }),
    logAudit: vi.fn(),
    validateForeignKey: async (
      delegate: { findFirst: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string } | null> },
      where: Record<string, unknown>,
      message: string,
    ) => {
      const record = await delegate.findFirst({ where, select: { id: true } });
      if (!record) throw new ApiError(message, 404);
      return record;
    },
  };
});

import { prisma } from '@/lib/prisma';
import { POST as createIntegration } from '../integrations/route';
import { PUT as updateIntegration } from '../integrations/[id]/route';

function makeReq(orgId: string, method = 'GET', body?: unknown) {
  const init = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1' } } as any;
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/v1/integrations', init);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('integrations route validation', () => {
  it('rejects invalid platform values before writing', async () => {
    const res = await createIntegration(makeReq('org-a', 'POST', {
      shopName: 'Shop A',
      platform: 'invalid-platform',
    }));

    expect(res.status).toBe(400);
    expect(prisma.ecommerceConnection.create).not.toHaveBeenCalled();
  });

  it('rejects creation when referenced customer is missing in the organization', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);

    const res = await createIntegration(makeReq('org-a', 'POST', {
      shopName: 'Shop A',
      platform: 'SHOPEE',
      customerId: 'cust-missing',
    }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Selected customer was not found.' });
  });

  it('rejects duplicate shop names for the same platform on update', async () => {
    vi.mocked(prisma.ecommerceConnection.findFirst)
      .mockResolvedValueOnce({
        id: 'conn-1',
        organizationId: 'org-a',
        platform: 'SHOPEE',
        shopName: 'Existing Shop',
        customerId: null,
        holdingAccountId: null,
      } as never)
      .mockResolvedValueOnce({ id: 'conn-2' } as never);

    const res = await updateIntegration(makeReq('org-a', 'PUT', {
      shopName: 'Existing Shop',
      platform: 'SHOPEE',
    }), params('conn-1'));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'This shop already exists for the selected platform.' });
    expect(prisma.ecommerceConnection.update).not.toHaveBeenCalled();
  });
});
