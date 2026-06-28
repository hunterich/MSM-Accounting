/**
 * Report route tests — AR aging, AP aging, and GL trial-balance.
 *
 * Prisma is fully mocked so no database is required.
 * All report handlers short-circuit when findMany returns [] (empty org scenario).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Prisma mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    salesInvoice: {
      findMany: vi.fn(),
    },
    aRPaymentAllocation: {
      groupBy: vi.fn(),
    },
    aRPayment: {
      findMany: vi.fn(),
    },
    creditNote: {
      findMany: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    bill: {
      findMany: vi.fn(),
    },
    aPPaymentAllocation: {
      groupBy: vi.fn(),
    },
    aPPayment: {
      findMany: vi.fn(),
    },
    debitNote: {
      findMany: vi.fn(),
    },
    vendor: {
      findFirst: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    journalLine: {
      findMany: vi.fn(),
    },
    bankTransaction: {
      findMany: vi.fn(),
    },
    inventoryLedgerEntry: {
      findMany: vi.fn(),
    },
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

vi.mock('@/lib/gl-reporting', () => ({
  buildTrialBalanceReport: vi.fn(() => ({ rows: [], totals: {} })),
  buildBalanceSheetReport: vi.fn(() => ({ sections: [] })),
  buildBalanceSheetMultiPeriodReport: vi.fn(() => ({ sections: [] })),
  buildProfitLossReport: vi.fn(() => ({ sections: [], netIncome: 0 })),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';
import { GET as getArReport } from '../reports/ar/route';
import { GET as getApReport } from '../reports/ap/route';
import { GET as getGlReport } from '../reports/gl/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, orgId: string | null, method = 'GET'): NextRequest {
  const headers: Record<string, string> = {};
  if (orgId !== null) {
    headers['x-org-id'] = orgId;
    headers['x-user-id'] = 'u1';
    headers['x-role-type'] = 'ADMIN';
  }
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: return empty arrays for all prisma calls
  vi.mocked(prisma.salesInvoice.findMany).mockResolvedValue([]);
  vi.mocked(prisma.aRPaymentAllocation.groupBy).mockResolvedValue([]);
  vi.mocked(prisma.aRPayment.findMany).mockResolvedValue([]);
  vi.mocked(prisma.creditNote.findMany).mockResolvedValue([]);
  vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.bill.findMany).mockResolvedValue([]);
  vi.mocked(prisma.aPPaymentAllocation.groupBy).mockResolvedValue([]);
  vi.mocked(prisma.aPPayment.findMany).mockResolvedValue([]);
  vi.mocked(prisma.debitNote.findMany).mockResolvedValue([]);
  vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.account.findMany).mockResolvedValue([]);
  vi.mocked(prisma.journalLine.findMany).mockResolvedValue([]);
  vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([]);
  vi.mocked(prisma.inventoryLedgerEntry.findMany).mockResolvedValue([]);
});

// ── Auth enforcement ─────────────────────────────────────────────────────────

describe('Report routes — auth enforcement', () => {
  it('GET /api/v1/reports/ar returns 401 without orgId header', async () => {
    const res = await getArReport(makeReq('/api/v1/reports/ar?type=aging', null));
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/reports/ap returns 401 without orgId header', async () => {
    const res = await getApReport(makeReq('/api/v1/reports/ap?type=aging', null));
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/reports/gl returns 401 without orgId header', async () => {
    const res = await getGlReport(makeReq('/api/v1/reports/gl?type=trial-balance', null));
    expect(res.status).toBe(401);
  });
});

// ── AR report ────────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/ar', () => {
  it('returns 200 with rows and summary for aging type (empty org)', async () => {
    const res = await getArReport(makeReq('/api/v1/reports/ar?type=aging', 'org-a'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('rows');
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('returns 200 with rows and summary for customer-balance type', async () => {
    const res = await getArReport(makeReq('/api/v1/reports/ar?type=customer-balance', 'org-a'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('rows');
    expect(body).toHaveProperty('summary');
  });
});

// ── AR customer statement ─────────────────────────────────────────────────────

describe('GET /api/v1/reports/ar?type=statement', () => {
  it('returns 400 when customerId is missing', async () => {
    const res = await getArReport(makeReq('/api/v1/reports/ar?type=statement', 'org-a'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the customer is not found', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
    const res = await getArReport(
      makeReq('/api/v1/reports/ar?type=statement&customerId=c1&dateFrom=2026-01-01&dateTo=2026-01-31', 'org-a'),
    );
    expect(res.status).toBe(404);
  });

  it('builds a statement with running balance, closing balance, and aging', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: 'c1', code: 'CUST-1', name: 'Acme', openingBalance: 0,
    } as never);
    vi.mocked(prisma.salesInvoice.findMany).mockResolvedValue([
      { id: 'i1', number: 'INV-1', issueDate: new Date('2026-01-05'), dueDate: new Date('2026-01-20'), totalAmount: 1_000_000 },
    ] as never);
    vi.mocked(prisma.aRPayment.findMany).mockResolvedValue([
      { number: 'PAY-1', date: new Date('2026-01-25'), totalAmount: 400_000 },
    ] as never);
    vi.mocked(prisma.aRPaymentAllocation.groupBy).mockResolvedValue([
      { invoiceId: 'i1', _sum: { amountApplied: 400_000, discountAmount: 0 } },
    ] as never);

    const res = await getArReport(
      makeReq('/api/v1/reports/ar?type=statement&customerId=c1&dateFrom=2026-01-01&dateTo=2026-01-31', 'org-a'),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.party).toMatchObject({ id: 'c1', name: 'Acme' });
    expect(body.openingBalance).toBe(0);
    expect(body.rows.map((r: { number: string }) => r.number)).toEqual(['INV-1', 'PAY-1']);
    expect(body.rows[1].runningBalance).toBe(600_000);
    expect(body.summary.closingBalance).toBe(600_000);
    expect(body.summary.totalDebits).toBe(1_000_000);
    expect(body.summary.totalCredits).toBe(400_000);
    // invoice due 2026-01-20, statement to 2026-01-31 → 11 days overdue → 1-30 bucket
    expect(body.summary.aging.d1To30).toBe(600_000);
  });
});

// ── AP report ────────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/ap', () => {
  it('returns 200 with rows and summary for aging type (empty org)', async () => {
    const res = await getApReport(makeReq('/api/v1/reports/ap?type=aging', 'org-a'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('rows');
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.rows)).toBe(true);
  });
});

// ── AP vendor statement ───────────────────────────────────────────────────────

describe('GET /api/v1/reports/ap?type=statement', () => {
  it('returns 400 when vendorId is missing', async () => {
    const res = await getApReport(makeReq('/api/v1/reports/ap?type=statement', 'org-a'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the vendor is not found', async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null);
    const res = await getApReport(
      makeReq('/api/v1/reports/ap?type=statement&vendorId=v1&dateFrom=2026-01-01&dateTo=2026-01-31', 'org-a'),
    );
    expect(res.status).toBe(404);
  });

  it('seeds opening balance from the vendor and ages the closing balance', async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
      id: 'v1', code: 'VEND-1', name: 'AWS', openingBalance: 500_000,
    } as never);
    vi.mocked(prisma.bill.findMany).mockResolvedValue([
      { id: 'b1', number: 'BILL-1', issueDate: new Date('2026-01-10'), dueDate: new Date('2026-02-09'), totalAmount: 2_000_000 },
    ] as never);
    vi.mocked(prisma.aPPayment.findMany).mockResolvedValue([
      { number: 'APPAY-1', date: new Date('2026-01-28'), totalAmount: 500_000 },
    ] as never);
    vi.mocked(prisma.aPPaymentAllocation.groupBy).mockResolvedValue([
      { billId: 'b1', _sum: { amountApplied: 500_000, discountAmount: 0 } },
    ] as never);

    const res = await getApReport(
      makeReq('/api/v1/reports/ap?type=statement&vendorId=v1&dateFrom=2026-01-01&dateTo=2026-01-31', 'org-a'),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.party).toMatchObject({ id: 'v1', name: 'AWS' });
    expect(body.openingBalance).toBe(500_000);
    expect(body.rows.map((r: { number: string }) => r.number)).toEqual(['BILL-1', 'APPAY-1']);
    expect(body.summary.closingBalance).toBe(2_000_000);
    // bill due 2026-02-09 (after statement end) → not yet due → current bucket
    expect(body.summary.aging.current).toBe(1_500_000);
  });
});

// ── GL report ────────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/gl', () => {
  it('returns 200 for trial-balance type', async () => {
    const res = await getGlReport(makeReq('/api/v1/reports/gl?type=trial-balance', 'org-a'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('type', 'trial-balance');
  });

  it('returns 200 for balance-sheet type', async () => {
    const res = await getGlReport(makeReq('/api/v1/reports/gl?type=balance-sheet', 'org-a'));
    expect(res.status).toBe(200);
  });
});
