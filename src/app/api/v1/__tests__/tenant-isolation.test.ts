/**
 * Tenant isolation tests — verify that [id] GET handlers return 404 for
 * records that exist but belong to a different org, and that mutations
 * cannot affect cross-org records.
 *
 * Prisma is mocked so no database is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Prisma mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer:         { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    vendor:           { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    item:             { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bill:             { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    account:          { findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bankAccount:      { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bankTransaction:  { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

// Minimal CORS passthrough so we can check res.status directly
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', () => ({
  ok:       (data: unknown, status = 200) => Response.json(data, { status }),
  err:      (msg: string, status: number) => Response.json({ error: msg }, { status }),
  logAudit: vi.fn(),
}));

// ── Route handler imports (after mocks) ─────────────────────────────────────

import { prisma } from '@/lib/prisma';

import { GET as customerGET, PUT as customerPUT, DELETE as customerDELETE }
  from '../customers/[id]/route';
import { GET as vendorGET }
  from '../vendors/[id]/route';
import { GET as itemGET, PUT as itemPUT }
  from '../items/[id]/route';
import { GET as billGET }
  from '../bills/[id]/route';
import { GET as accountGET, DELETE as accountDELETE }
  from '../accounts/[id]/route';
import { GET as bankAccountGET }
  from '../bank-accounts/[id]/route';
import { GET as bankTxGET }
  from '../bank-transactions/[id]/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(orgId: string, method = 'GET', body?: unknown): NextRequest {
  const init: RequestInit = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1' } };
  if (body) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/v1/test/abc', init as ConstructorParameters<typeof NextRequest>[1]);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET — cross-org isolation ────────────────────────────────────────────────

describe('GET [id] returns 404 when record belongs to a different org', () => {
  it('customer', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
    const res = await customerGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    // Verify the query included the caller's orgId
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('vendor', async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null);
    const res = await vendorGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    expect(prisma.vendor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('item', async () => {
    vi.mocked(prisma.item.findFirst).mockResolvedValue(null);
    const res = await itemGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    expect(prisma.item.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('bill', async () => {
    vi.mocked(prisma.bill.findFirst).mockResolvedValue(null);
    const res = await billGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    expect(prisma.bill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('account', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    const res = await accountGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    expect(prisma.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('bankAccount', async () => {
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null);
    const res = await bankAccountGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('bankTransaction', async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue(null);
    const res = await bankTxGET(makeReq('org-a'), params('id-from-org-b'));
    expect(res.status).toBe(404);
    expect(prisma.bankTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });
});

// ── Mutation isolation: PUT/DELETE use orgId in where clause ─────────────────

describe('PUT and DELETE scope mutations by orgId', () => {
  it('customer PUT uses orgId in where clause', async () => {
    const fakeCustomer = { id: 'c1', organizationId: 'org-a', name: 'Test' };
    vi.mocked(prisma.customer.update).mockResolvedValue(fakeCustomer as never);
    const req = makeReq('org-a', 'PUT', { name: 'Updated' });
    await customerPUT(req, params('c1'));
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('customer DELETE uses orgId in where clause', async () => {
    vi.mocked(prisma.customer.delete).mockResolvedValue({} as never);
    const req = makeReq('org-a', 'DELETE');
    await customerDELETE(req, params('c1'));
    expect(prisma.customer.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });

  it('item PUT uses orgId in where clause', async () => {
    const fakeItem = { id: 'i1', organizationId: 'org-a', name: 'Widget' };
    vi.mocked(prisma.item.update).mockResolvedValue(fakeItem as never);
    const req = makeReq('org-a', 'PUT', { name: 'Updated Widget' });
    await itemPUT(req, params('i1'));
    expect(prisma.item.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) })
    );
  });
});

// ── accounts DELETE: org-scoped pre-check before child count ─────────────────

describe('accounts DELETE verifies org ownership before child count', () => {
  it('returns 404 when account does not belong to org before counting children', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null); // ownership check fails
    const res = await accountDELETE(makeReq('org-a', 'DELETE'), params('acc-from-org-b'));
    expect(res.status).toBe(404);
    // count should NOT have been called — we short-circuit at the ownership check
    expect(prisma.account.count).not.toHaveBeenCalled();
  });

  it('returns 400 when account has sub-accounts', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({ id: 'acc-1', organizationId: 'org-a' } as never);
    vi.mocked(prisma.account.count).mockResolvedValue(2);
    const res = await accountDELETE(makeReq('org-a', 'DELETE'), params('acc-1'));
    expect(res.status).toBe(400);
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });
});
