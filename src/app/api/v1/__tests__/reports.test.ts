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
    bill: {
      findMany: vi.fn(),
    },
    aPPaymentAllocation: {
      groupBy: vi.fn(),
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
  }
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: return empty arrays for all prisma calls
  vi.mocked(prisma.salesInvoice.findMany).mockResolvedValue([]);
  vi.mocked(prisma.aRPaymentAllocation.groupBy).mockResolvedValue([]);
  vi.mocked(prisma.bill.findMany).mockResolvedValue([]);
  vi.mocked(prisma.aPPaymentAllocation.groupBy).mockResolvedValue([]);
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
