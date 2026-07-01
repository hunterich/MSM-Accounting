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

vi.mock('@/lib/settlement-import', () => ({
  importSettlement: vi.fn().mockResolvedValue({ posted: 0, alreadySettled: 0, skipped: [], failed: [] }),
}));

import { POST } from '../integrations/[id]/settlement-import/route';

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

describe('settlement import route body validation', () => {
  it('returns 400 when orders array is empty', async () => {
    const res = await POST(
      makeJsonReq('/api/v1/integrations/conn-1/settlement-import', {
        orders: [],
      }),
      params('conn-1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when orders field is missing', async () => {
    const res = await POST(
      makeJsonReq('/api/v1/integrations/conn-1/settlement-import', {}),
      params('conn-1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
