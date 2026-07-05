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
    bankAccount: {
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
import { GET as getBankingReport } from '../reports/banking/route';

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
  vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);
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

// ── Banking cash & bank reports ───────────────────────────────────────────────

describe('GET /api/v1/reports/banking — cash & bank reports', () => {
  const req = (qs: string) => makeReq(`/api/v1/reports/banking?${qs}`, 'org1');

  it('bank-history: opening = account opening + prior movements, with running balance and transfers both directions', async () => {
    vi.mocked(prisma.bankAccount.findMany)
      // first call: scoped accounts (has openingBalance); second call: id→name map
      .mockResolvedValueOnce([{ id: 'A', name: 'BCA', code: 'BCA', bankName: 'BCA', openingBalance: 100 } as never])
      .mockResolvedValueOnce([{ id: 'A', name: 'BCA' }, { id: 'B', name: 'Mandiri' }] as never);
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([
      { id: 't0', number: 'BK0', date: new Date('2026-05-31'), description: 'prior', amount: 50, type: 'INCOME', reference: null, payee: null, receivedFrom: 'x', bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-05-31'), journalEntry: { entryNo: 'JE0' } },
      { id: 't1', number: 'BK1', date: new Date('2026-06-02'), description: 'sale', amount: 30, type: 'INCOME', reference: null, payee: null, receivedFrom: 'Cust', bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-06-02'), journalEntry: { entryNo: 'JE1' } },
      { id: 't2', number: 'BK2', date: new Date('2026-06-05'), description: 'to Mandiri', amount: 20, type: 'TRANSFER', reference: null, payee: null, receivedFrom: null, bankAccountId: 'A', toBankAccountId: 'B', createdAt: new Date('2026-06-05'), journalEntry: { entryNo: 'JE2' } },
    ] as never);

    const res = await getBankingReport(req('type=bank-history&bankAccountId=A&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.banks).toHaveLength(1);
    const bank = body.banks[0];
    expect(bank.openingBalance).toBe(150); // 100 opening + 50 prior income
    expect(bank.rows).toHaveLength(2);      // t1 (in) + t2 (transfer out); t0 excluded (prior)
    expect(bank.rows[0].moneyIn).toBe(30);
    expect(bank.rows[0].runningBalance).toBe(180);
    expect(bank.rows[1].moneyOut).toBe(20); // transfer OUT of A
    expect(bank.rows[1].runningBalance).toBe(160);
    expect(bank.closingBalance).toBe(160);
    expect(bank.totalIn).toBe(30);
    expect(bank.totalOut).toBe(20);
  });

  it('bank-received: includes income + incoming transfers, excludes payments', async () => {
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([{ id: 'A', name: 'BCA' }, { id: 'B', name: 'Mandiri' }] as never);
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([
      { id: 'r1', number: 'BK1', date: new Date('2026-06-02'), description: 'sale', amount: 30, type: 'INCOME', reference: null, payee: null, receivedFrom: 'Cust', bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-06-02'), journalEntry: { entryNo: 'JE1' } },
      { id: 'r2', number: 'BK2', date: new Date('2026-06-04'), description: 'from Mandiri', amount: 15, type: 'TRANSFER', reference: null, payee: null, receivedFrom: null, bankAccountId: 'B', toBankAccountId: 'A', createdAt: new Date('2026-06-04'), journalEntry: { entryNo: 'JE2' } },
    ] as never);

    const res = await getBankingReport(req('type=bank-received&bankAccountId=A&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.summary).toEqual({ count: 2, totalReceived: 45 });
    expect(body.rows[1].from).toBe('Mandiri'); // incoming transfer's source bank name
    expect(body.rows[0].journalEntryNo).toBe('JE1');
  });

  it('bank-payment: includes expense + outgoing transfers, with dest bank as payee', async () => {
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([{ id: 'A', name: 'BCA' }, { id: 'B', name: 'Mandiri' }] as never);
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([
      { id: 'p1', number: 'BK1', date: new Date('2026-06-03'), description: 'buy', amount: 8, type: 'EXPENSE', reference: null, payee: 'Vendor', receivedFrom: null, bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-06-03'), journalEntry: { entryNo: 'JE1' } },
      { id: 'p2', number: 'BK2', date: new Date('2026-06-06'), description: 'to Mandiri', amount: 20, type: 'TRANSFER', reference: null, payee: null, receivedFrom: null, bankAccountId: 'A', toBankAccountId: 'B', createdAt: new Date('2026-06-06'), journalEntry: { entryNo: 'JE2' } },
    ] as never);

    const res = await getBankingReport(req('type=bank-payment&bankAccountId=A&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.summary).toEqual({ count: 2, totalPaid: 28 });
    expect(body.rows[1].payee).toBe('Mandiri'); // outgoing transfer's destination bank name
  });

  it('bank-received returns empty when no bankAccountId given', async () => {
    const res = await getBankingReport(req('type=bank-received&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.summary).toEqual({ count: 0, totalReceived: 0 });
    expect(body.rows).toEqual([]);
  });
});
