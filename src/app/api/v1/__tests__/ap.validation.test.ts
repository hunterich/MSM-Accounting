/**
 * AP validation tests — bill creation and GET auth enforcement.
 *
 * Prisma is fully mocked so no database is required.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Prisma mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bill: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    billLine: {
      createMany: vi.fn(),
    },
    billAttachment: {
      create: vi.fn(),
    },
    vendor: {
      findFirst: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    item: {
      findMany: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    journalEntry: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
      bill: { create: vi.fn(), findUnique: vi.fn() },
      billLine: { createMany: vi.fn() },
      billAttachment: { create: vi.fn() },
      vendor: { findFirst: vi.fn() },
      organization: { findUnique: vi.fn() },
      item: { findMany: vi.fn() },
      account: { findMany: vi.fn() },
      journalEntry: { create: vi.fn() },
      $queryRaw: vi.fn(),
    })),
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
    nextNumber: vi.fn(async () => 'BILL-0001'),
    validateForeignKey: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/inventory-costing', () => ({
  addCostLayer: vi.fn(async () => undefined),
  calculateAndPostCOGS: vi.fn(async () => 0),
}));

vi.mock('@/lib/account-defaults', () => ({
  resolveAccountDefaultId: vi.fn(() => null),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';
import { GET as getBills, POST as createBill } from '../bills/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, orgId: string | null, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (orgId !== null) {
    headers['x-org-id'] = orgId;
    headers['x-user-id'] = 'u1';
  }
  const init = { method, headers } as any;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost${path}`, init);
}

const validBillLine = {
  description: 'Office supplies',
  quantity: 1,
  price: 50,
  unit: 'PCS',
};

const validBillPayload = {
  vendorId: 'vendor-1',
  issueDate: '2026-04-01',
  lines: [validBillLine],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/bills — validation', () => {
  it('returns 400 when vendorId is missing', async () => {
    const res = await createBill(makeReq('/api/v1/bills', 'org-a', 'POST', {
      issueDate: '2026-04-01',
      lines: [validBillLine],
    }));

    expect(res.status).toBe(400);
  });

  it('calls prisma.bill.create (via $transaction) for a valid payload', async () => {
    const stubBill = {
      id: 'bill-1',
      number: 'BILL-0001',
      organizationId: 'org-a',
      vendorId: 'vendor-1',
      issueDate: new Date('2026-04-01'),
      status: 'DRAFT',
      totalAmount: 50,
      lines: [],
      vendor: { id: 'vendor-1', name: 'Supplier Co' },
      attachments: [],
    };

    const mockTx = {
      bill: {
        create: vi.fn(async () => ({ id: 'bill-1', number: 'BILL-0001' })),
        findUnique: vi.fn(async () => stubBill),
      },
      billLine: { createMany: vi.fn(async () => ({ count: 0 })) },
      billAttachment: { create: vi.fn() },
      vendor: { findFirst: vi.fn(async () => ({ id: 'vendor-1' })) },
      organization: { findUnique: vi.fn(async () => ({ costingMethod: null })) },
      item: { findMany: vi.fn(async () => []) },
      account: { findMany: vi.fn(async () => []) },
      journalEntry: { create: vi.fn() },
      $queryRaw: vi.fn(async () => [{ max_seq: null }]),
    };

    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (callback: (tx: any) => Promise<unknown>) => callback(mockTx),
    );

    const res = await createBill(makeReq('/api/v1/bills', 'org-a', 'POST', validBillPayload));

    expect(res.status).toBe(201);
    expect(mockTx.bill.create).toHaveBeenCalled();
  });
});

describe('GET /api/v1/bills — auth enforcement', () => {
  it('returns 401 when x-org-id header is missing', async () => {
    const res = await getBills(makeReq('/api/v1/bills', null, 'GET'));
    expect(res.status).toBe(401);
  });
});
