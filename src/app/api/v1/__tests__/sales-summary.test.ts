import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn(), salesInvoice: { findMany: vi.fn() } } }));
vi.mock('@/lib/cors', () => ({ withCors: (res: Response) => res, CORS_HEADERS: {}, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
import { prisma } from '@/lib/prisma';
import { GET } from '../reports/sales/route';

function req(type: string, params = '') {
  return new NextRequest(`http://localhost/api/v1/reports/sales?type=${type}${params}`, {
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'admin', 'x-role-type': 'ADMIN' },
  });
}
beforeEach(() => vi.clearAllMocks());

describe('sales summaries above the former transaction cap', () => {
  it('returns annual sales for 350,000 orders without loading invoices', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { customerId: 'shopee', customerName: 'Shopee', invoiceCount: 174917, total: new Prisma.Decimal(350000000) },
      { customerId: 'tiktok', customerName: 'TikTok', invoiceCount: 175083, total: new Prisma.Decimal(350000000) },
    ]);
    const res = await GET(req('by-customer'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grandTotal).toBe(700000000);
    expect(body.rows.reduce((n: number, r: { invoiceCount: number }) => n + r.invoiceCount, 0)).toBe(350000);
    expect(prisma.salesInvoice.findMany).not.toHaveBeenCalled();
  });

  it('keeps Others in the share report total', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { customerId: 'a', customerName: 'A', invoiceCount: 200000, total: new Prisma.Decimal(200) },
      { customerId: 'b', customerName: 'B', invoiceCount: 150000, total: new Prisma.Decimal(150) },
    ]);
    const body = await (await GET(req('share-by-customer', '&topN=1'))).json();
    expect(body.rows).toEqual([
      { customerName: 'A', total: 200, isOthers: false },
      { customerName: 'Others', total: 150, isOthers: true },
    ]);
    expect(body.grandTotal).toBe(350);
  });

  it('ranks top products by quantity and retains the response fields', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { itemId: 'a', sku: 'A', name: 'A', qty: new Prisma.Decimal(700000), total: new Prisma.Decimal(700000000) },
      { itemId: 'b', sku: 'B', name: 'B', qty: new Prisma.Decimal(900000), total: new Prisma.Decimal(450000000) },
    ]);
    const body = await (await GET(req('top-products', '&sortBy=qty&topN=1'))).json();
    expect(body.rows).toEqual([{ itemId: 'b', sku: 'B', name: 'B', qty: 900000, total: 450000000 }]);
    expect(body.grandTotal).toBe(450000000);
  });
});
