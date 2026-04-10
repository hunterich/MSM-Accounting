/**
 * AR validation tests — invoice creation and GET auth enforcement.
 *
 * Prisma is fully mocked so no database is required.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Prisma mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    salesInvoice: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
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
    userOrganization: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
      salesInvoice: { create: vi.fn() },
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
  };
});

vi.mock('@/lib/document-access', () => ({
  getInvoiceAccessContext: vi.fn(async () => ({
    userId: 'u1',
    orgId: 'org-a',
    roleType: 'ADMIN',
    invoiceAccessScope: 'ALL',
  })),
  applyInvoiceAccessScope: vi.fn((where: Record<string, unknown>) => where),
}));

vi.mock('@/lib/credit-limit', () => ({
  calculateSalesOrderTotal: vi.fn(() => 0),
  CreditLimitError: class CreditLimitError extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  },
  enforceCustomerCreditLimit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/inventory-costing', () => ({
  calculateAndPostCOGS: vi.fn(async () => 0),
}));

vi.mock('@/lib/account-defaults', () => ({
  resolveAccountDefaultId: vi.fn(() => null),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';
import { GET as getInvoices, POST as createInvoice } from '../invoices/route';

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

const validInvoiceLine = {
  description: 'Widget',
  quantity: 2,
  price: 100,
  unit: 'PCS',
};

const validInvoicePayload = {
  customerId: 'cust-1',
  issueDate: '2026-04-01',
  lines: [validInvoiceLine],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/invoices — validation', () => {
  it('returns 400 when customerId is missing', async () => {
    const res = await createInvoice(makeReq('/api/v1/invoices', 'org-a', 'POST', {
      issueDate: '2026-04-01',
      lines: [validInvoiceLine],
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 when lines array is empty', async () => {
    const res = await createInvoice(makeReq('/api/v1/invoices', 'org-a', 'POST', {
      customerId: 'cust-1',
      issueDate: '2026-04-01',
      lines: [],
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 when lines are absent', async () => {
    const res = await createInvoice(makeReq('/api/v1/invoices', 'org-a', 'POST', {
      customerId: 'cust-1',
      issueDate: '2026-04-01',
    }));

    expect(res.status).toBe(400);
  });

  it('calls prisma.salesInvoice.create (via $transaction) for a valid payload', async () => {
    // Provide a stub $transaction that simulates successful creation
    const stubInvoice = {
      id: 'inv-1',
      number: 'INV-000001',
      subtotal: 200,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 200,
      currency: 'IDR',
      lines: [],
    };

    const mockTx = {
      organization: { findUnique: vi.fn(async () => ({
        id: 'org-a',
        taxEnabled: false,
        taxDefaultRate: 0,
        taxInclusiveByDefault: false,
        costingMethod: null,
      })) },
      salesInvoice: { create: vi.fn(async () => stubInvoice) },
      item: { findMany: vi.fn(async () => []) },
      account: { findMany: vi.fn(async () => []) },
      journalEntry: { create: vi.fn() },
      $queryRaw: vi.fn(async () => [{ max_seq: null }]),
    };

    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (callback: (tx: any) => Promise<unknown>) => callback(mockTx),
    );

    const res = await createInvoice(makeReq('/api/v1/invoices', 'org-a', 'POST', validInvoicePayload));

    // Should have hit the create path — status 201
    expect(res.status).toBe(201);
    expect(mockTx.salesInvoice.create).toHaveBeenCalled();
  });
});

describe('GET /api/v1/invoices — auth enforcement', () => {
  it('returns 401 when x-org-id header is missing', async () => {
    const res = await getInvoices(makeReq('/api/v1/invoices', null, 'GET'));
    expect(res.status).toBe(401);
  });
});
