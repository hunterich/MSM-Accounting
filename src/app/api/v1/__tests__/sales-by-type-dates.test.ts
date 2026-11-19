/**
 * Sales by Type must use the Jakarta business day for its date boundaries,
 * like every other report (reportDate), not server-local midnight.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    salesInvoice: { groupBy: vi.fn() },
    salesType: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

import { prisma } from '@/lib/prisma';
import { GET } from '../reports/sales/by-type/route';

const req = (query: string) => new NextRequest(`http://localhost/api/v1/reports/sales/by-type${query}`, {
  headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.salesInvoice.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.salesType.findMany).mockResolvedValue([]);
});

describe('GET /api/v1/reports/sales/by-type dates', () => {
  it('bounds issueDate by the Jakarta business day', async () => {
    const res = await GET(req('?from=2026-09-01&to=2026-09-30'));
    expect(res.status).toBe(200);
    const where = vi.mocked(prisma.salesInvoice.groupBy).mock.calls[0][0].where as any;
    expect(where.issueDate.gte.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(where.issueDate.lte.toISOString()).toBe('2026-09-30T16:59:59.999Z');
  });

  it('leaves the range open when no dates are given', async () => {
    await GET(req(''));
    const where = vi.mocked(prisma.salesInvoice.groupBy).mock.calls[0][0].where as any;
    expect(where.issueDate).toBeUndefined();
  });

  it('rejects an invalid date instead of reporting on a bad range', async () => {
    const res = await GET(req('?from=2026-02-30&to=2026-03-31'));
    expect(res.status).toBe(400);
    expect(prisma.salesInvoice.groupBy).not.toHaveBeenCalled();
  });

  it('rejects from after to', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-09-30'));
    expect(res.status).toBe(400);
  });
});
