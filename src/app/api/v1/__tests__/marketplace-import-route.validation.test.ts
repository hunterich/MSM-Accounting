import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
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

vi.mock('@/lib/marketplace-import', () => ({
  importMarketplaceOrders: vi.fn().mockResolvedValue({ created: 0, skipped: 0, failed: 0 }),
}));

vi.mock('@/lib/marketplace-import-preview', () => ({
  previewMarketplaceOrders: vi.fn().mockResolvedValue({ create: 0, alreadyImported: 0, blocked: 1, orders: [] }),
}));

import { POST } from '../integrations/[id]/import/route';
import { POST as previewPOST } from '../integrations/[id]/import/preview/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function makeJsonReq(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'x-org-id': 'org-a',
      'x-user-id': 'user-1',
      'x-role-type': 'ADMIN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('marketplace import route body validation', () => {
  it('accepts an unmapped item for read-only preview while import remains strict', async () => {
    const body = {
      orders: [{
        orderNo: 'ORD-UNMAPPED', issueDate: '2026-06-01', sourceTotal: 1000, missingDate: false,
        lines: [{ itemId: '', description: 'Unmapped product', quantity: 1, unitPrice: 1000 }],
      }],
      options: { recordPayment: false },
    };
    const preview = await previewPOST(makeJsonReq('/api/v1/integrations/conn-1/import/preview', body), params('conn-1'));
    expect(preview.status).toBe(200);
    const imported = await POST(makeJsonReq('/api/v1/integrations/conn-1/import', body), params('conn-1'));
    expect(imported.status).toBe(400);
  });

  it('returns 400 when orders array is empty', async () => {
    const res = await POST(
      makeJsonReq('/api/v1/integrations/conn-1/import', {
        orders: [],
        options: { recordPayment: true },
      }),
      params('conn-1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when orders field is missing', async () => {
    const res = await POST(
      makeJsonReq('/api/v1/integrations/conn-1/import', {
        options: { recordPayment: true },
      }),
      params('conn-1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when an order line is missing itemId', async () => {
    const res = await POST(
      makeJsonReq('/api/v1/integrations/conn-1/import', {
        orders: [
          {
            orderNo: 'ORD-001',
            issueDate: '2026-06-01',
            lines: [
              {
                // itemId intentionally omitted
                description: 'Widget',
                quantity: 2,
                unitPrice: 10000,
              },
            ],
          },
        ],
        options: { recordPayment: true },
      }),
      params('conn-1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    // Zod reports "Required" when the field is absent entirely
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when options field is missing', async () => {
    const res = await POST(
      makeJsonReq('/api/v1/integrations/conn-1/import', {
        orders: [
          {
            orderNo: 'ORD-001',
            issueDate: '2026-06-01',
            lines: [
              {
                itemId: 'item-1',
                description: 'Widget',
                quantity: 2,
                unitPrice: 10000,
              },
            ],
          },
        ],
        // options omitted
      }),
      params('conn-1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
