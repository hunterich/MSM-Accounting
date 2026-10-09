import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {
  account: { findMany: vi.fn() }, organization: { findUnique: vi.fn() }, item: { findMany: vi.fn() },
  journalLine: { groupBy: vi.fn() }, userOrganization: { findFirst: vi.fn() }, $queryRaw: vi.fn(),
} }));
vi.mock('@/lib/cors', () => ({ withCors: (res: Response) => res, corsPreflightResponse: () => new Response(null, { status: 204 }), CORS_HEADERS: {} }));

import { prisma } from '@/lib/prisma';
import { GET } from '../reports/dashboard/route';
const request = (query: string, authenticated = true) => new NextRequest(`http://localhost/api/v1/reports/dashboard?${query}`, {
  headers: authenticated ? { 'x-org-id': 'org-test', 'x-user-id': 'admin', 'x-role-type': 'ADMIN' } : {},
});
beforeEach(() => vi.clearAllMocks());

describe('dashboard financial reports', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await GET(request('type=sales', false))).status).toBe(401);
  });
  it('denies users without report access before querying financial data', async () => {
    vi.mocked(prisma.userOrganization.findFirst).mockResolvedValue(null);
    const req = request('type=sales');
    req.headers.set('x-role-type', 'STAFF');
    expect((await GET(req)).status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it.each(['dateFrom=2026-02-30&dateTo=2026-10-08', 'dateFrom=2026-11-01&dateTo=2026-10-08'])('rejects invalid or inverted dates: %s', async query => {
    expect((await GET(request(`type=sales&${query}`))).status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('returns reconciled period sales and all-date outstanding, preserving decimal precision', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ grossSales: '100.25', returns: '0', paid: '80.15', unpaid: '20.10', current: '20.10', overdue: '40.20' }]);
    const response = await GET(request('type=sales&dateFrom=2026-10-01&dateTo=2026-10-08'));
    const data = await response.json();
    expect(data).toEqual({ sales: 100.25, grossSales: 100.25, returns: 0, paid: 80.15, unpaid: 20.1, current: 20.1, overdue: 40.2, outstanding: 60.3 });
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as { values: unknown[] };
    expect(sql.values).toContain('org-test');
    expect(sql.values).toContainEqual(new Date('2026-09-30T17:00:00Z'));
    expect(sql.values).toContainEqual(new Date('2026-10-08T16:59:59.999Z'));
  });
  it('splits configured and item COGS from expenditure without double counting', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'income', code: '4100', name: 'Sales', type: 'REVENUE', normalSide: 'CREDIT', isActive: true, isPostable: true },
      { id: 'cost', code: '5100', name: 'Custom Cost', type: 'EXPENSE', normalSide: 'DEBIT', isActive: true, isPostable: true },
      { id: 'old-cost', code: '5101', name: 'Old Cost', type: 'EXPENSE', normalSide: 'DEBIT', isActive: false, isPostable: true },
      { id: 'rent', code: '6100', name: 'Rent', type: 'EXPENSE', normalSide: 'DEBIT', isActive: true, isPostable: true },
    ] as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ accountDefaults: { cogsExpense: 'cost' } } as never);
    vi.mocked(prisma.item.findMany).mockResolvedValue([{ cogsAccountId: 'old-cost' }, { cogsAccountId: 'cost' }] as never);
    vi.mocked(prisma.journalLine.groupBy).mockResolvedValue([
      { accountId: 'income', _sum: { debit: 0, credit: 1000 } },
      { accountId: 'cost', _sum: { debit: 300, credit: 50 } },
      { accountId: 'old-cost', _sum: { debit: 100, credit: 0 } },
      { accountId: 'rent', _sum: { debit: 200, credit: 0 } },
    ] as never);
    const response = await GET(request('type=profit-loss&dateFrom=2026-01-01&dateTo=2026-10-08'));
    expect(await response.json()).toEqual({ income: 1000, cogs: 350, expenditure: 200, profit: 450 });
    expect(prisma.journalLine.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { entry: { organizationId: 'org-test', status: 'POSTED', date: { gte: new Date('2025-12-31T17:00:00Z'), lte: new Date('2026-10-08T16:59:59.999Z') } } } }));
  });
  it('calculates customer shares from all customers before limiting the displayed ranking', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ customerId: `c${i}`, customerName: `Customer ${i}`, total: 100 })));
    const response = await GET(request('type=customers&dateFrom=2026-10-01&dateTo=2026-10-08'));
    const data = await response.json();
    expect(data.rows).toHaveLength(10);
    expect(data.grandTotal).toBe(1200);
  });
});
