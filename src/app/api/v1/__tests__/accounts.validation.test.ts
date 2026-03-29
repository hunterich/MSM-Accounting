import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    journalLine: {
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', () => ({
  ok: (data: unknown, status = 200) => Response.json(data, { status }),
  err: (msg: string, status: number) => Response.json({ error: msg }, { status }),
  logAudit: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { POST as createAccount } from '../accounts/route';
import { PUT as updateAccount, DELETE as deleteAccount } from '../accounts/[id]/route';

function makeReq(orgId: string, method = 'GET', body?: unknown) {
  const init: RequestInit = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1' } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/v1/accounts', init);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const baseAccounts = [
  {
    id: 'root-asset',
    code: '1000',
    name: 'Assets',
    type: 'Asset',
    parentId: null,
    level: 0,
    isPostable: false,
    isActive: true,
    reportGroup: 'Balance Sheet',
    reportSubGroup: null,
    normalSide: 'Debit',
    hasPostings: false,
  },
  {
    id: 'cash',
    code: '1100',
    name: 'Cash',
    type: 'Asset',
    parentId: 'root-asset',
    level: 1,
    isPostable: true,
    isActive: true,
    reportGroup: 'Current Assets',
    reportSubGroup: null,
    normalSide: 'Debit',
    hasPostings: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('accounts route validation', () => {
  it('rejects creating a child under a postable parent', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue(baseAccounts as never);

    const res = await createAccount(makeReq('org-a', 'POST', {
      code: '110001',
      name: 'Cash Drawer',
      type: 'Asset',
      parentId: 'cash',
      isPostable: true,
      isActive: true,
      reportGroup: 'Current Assets',
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Cannot use a postable account as parent.' });
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it('derives normal side and level when creating an account', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue(baseAccounts as never);
    vi.mocked(prisma.account.create).mockResolvedValue({ id: 'bank' } as never);

    const res = await createAccount(makeReq('org-a', 'POST', {
      code: '100001',
      name: 'Bank',
      type: 'Asset',
      parentId: 'root-asset',
      isPostable: true,
      isActive: true,
      reportGroup: 'Current Assets',
      normalSide: 'Credit',
    }));

    expect(res.status).toBe(201);
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          normalSide: 'DEBIT',
          type: 'ASSET',
          level: 1,
        }),
      }),
    );
  });

  it('rejects changing parent for an account that already has postings', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      ...baseAccounts[1],
      journalLines: [{ id: 'jl-1' }],
    } as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue(baseAccounts as never);

    const res = await updateAccount(makeReq('org-a', 'PUT', {
      parentId: null,
    }), params('cash'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Parent is locked because this account already has postings.' });
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('blocks deleting an account referenced by journal entries', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(baseAccounts[1] as never);
    vi.mocked(prisma.account.count).mockResolvedValue(0);
    vi.mocked(prisma.journalLine.count).mockResolvedValue(3);

    const res = await deleteAccount(makeReq('org-a', 'DELETE'), params('cash'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Cannot delete account that is referenced by journal entries' });
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });
});
