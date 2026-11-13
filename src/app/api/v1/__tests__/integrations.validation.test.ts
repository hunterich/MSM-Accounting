import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    account: { findMany: vi.fn() },
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

vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    logAudit: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { POST as createIntegration } from '../integrations/route';
import { PUT as updateIntegration } from '../integrations/[id]/route';

function makeReq(orgId: string, method = 'GET', body?: unknown) {
  const init = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1', 'x-role-type': 'ADMIN' } } as any;
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
  it('rejects a mapped GL account outside the company before saving', async () => {
    vi.mocked(prisma.ecommerceConnection.findFirst).mockResolvedValueOnce({ id: 'conn-1', organizationId: 'org-a', platform: 'SHOPEE', shopName: 'Shop', customerId: null, holdingAccountId: null } as never);
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([]);
    const res = await updateIntegration(makeReq('org-a', 'PUT', { mappings: { paymentMode: 'direct', vatInclusive: true, fees: { platformFeeAccountId: 'foreign-account' } } }), params('conn-1'));
    expect(res.status).toBe(400);
    expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', isActive: true, isPostable: true }) }));
    expect(prisma.ecommerceConnection.update).not.toHaveBeenCalled();
  });

  it('saves VAT and preserves other mapping fields', async () => {
    vi.mocked(prisma.ecommerceConnection.findFirst).mockResolvedValueOnce({ id: 'conn-1', organizationId: 'org-a', platform: 'SHOPEE', shopName: 'Shop', customerId: null, holdingAccountId: null } as never).mockResolvedValueOnce(null);
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([{ id: 'fee' }, { id: 'discount' }, { id: 'shipping' }, { id: 'adjustment' }, { id: 'affiliate' }] as never);
    vi.mocked(prisma.ecommerceConnection.update).mockResolvedValueOnce({ id: 'conn-1' } as never);
    const mappings = { paymentMode: 'settlement_import', vatInclusive: true, fees: { platformFeeAccountId: 'fee', sellerDiscountAccountId: 'discount', shippingVarianceAccountId: 'shipping', adjustmentAccountId: 'adjustment', affiliateFeeAccountId: 'affiliate', extra: 'keep' }, extraConfig: { value: 1 } };
    const res = await updateIntegration(makeReq('org-a', 'PUT', { mappings }), params('conn-1'));
    expect(res.status).toBe(200);
    expect(prisma.ecommerceConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mappings }) }));
  });

  it('rejects clearing a required fee mapping in settlement mode', async () => {
    vi.mocked(prisma.ecommerceConnection.findFirst).mockResolvedValueOnce({ id: 'conn-1', organizationId: 'org-a', platform: 'SHOPEE', shopName: 'Shop', customerId: null, holdingAccountId: null } as never);
    const res = await updateIntegration(makeReq('org-a', 'PUT', { mappings: { paymentMode: 'settlement_import', vatInclusive: true, fees: { sellerDiscountAccountId: 'discount', shippingVarianceAccountId: 'shipping', platformFeeAccountId: null, adjustmentAccountId: 'adjustment', affiliateFeeAccountId: 'affiliate' } } }), params('conn-1'));
    expect(res.status).toBe(400);
    expect(prisma.ecommerceConnection.update).not.toHaveBeenCalled();
  });

});
