/**
 * Posting balance-invariant tests for the AR/AP reversal mechanism
 * (credit notes + debit notes) and the journal-entries [id] PUT path.
 *
 * Background: this codebase has no `void` or `reverse` action that creates
 * a reversal JE from an already-posted document. Status enums include
 * VOID/CANCELLED and PUT endpoints can flip status, but no GL reversal
 * logic is wired. Credit notes (DR Sales-Return / CR AR) and debit notes
 * (DR AP / CR Purchase-Return) are the actual reversal mechanism — they're
 * new documents that book against the original receivable/payable.
 *
 * Each test below:
 *   1. drives the route handler with a payload that would float-fail
 *      under naive Number() arithmetic,
 *   2. captures the JE payload Prisma sees,
 *   3. asserts `assertLinesBalanced` passes,
 *   4. asserts the persisted amount === the rounded expected value.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { assertLinesBalanced } from '../../../../../lib/__tests__/journal-balance-helper';

// ── Prisma mock ──────────────────────────────────────────────────────────────

type CreateCall = { data: Record<string, unknown> };

const createCalls = {
  creditNote: [] as CreateCall[],
  debitNote: [] as CreateCall[],
  journalEntry: [] as CreateCall[],
  journalLine: [] as CreateCall[],
};

// State for the journal-entries [id] PUT path
let putExistingEntry: { id: string; status: string; organizationId: string; lines: { accountId: string }[] } | null = null;
const putUpdates: Record<string, unknown>[] = [];
const putLineCreates: Record<string, unknown>[] = [];

const txStub = () => {
  const queryRawMock = vi.fn().mockResolvedValue([{ max_seq: 99 }]);
  return {
    $queryRaw: queryRawMock,
    creditNote: {
      create: vi.fn(async ({ data }: CreateCall) => {
        createCalls.creditNote.push({ data });
        return { id: 'cn-1', number: 'CRN-0001', date: data.date, ...data };
      }),
    },
    debitNote: {
      create: vi.fn(async ({ data }: CreateCall) => {
        createCalls.debitNote.push({ data });
        return { id: 'dn-1', number: 'DBN-0001', date: data.date, ...data };
      }),
    },
    journalEntry: {
      create: vi.fn(async ({ data }: CreateCall) => {
        createCalls.journalEntry.push({ data });
        return { id: 'je-1', entryNo: 'JE-000100' };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        putUpdates.push(data);
        return { id: 'je-put-1', ...data };
      }),
      findFirst: vi.fn(async () => putExistingEntry),
    },
    journalLine: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) putLineCreates.push(d);
        createCalls.journalLine.push({ data: { rows: data } as Record<string, unknown> });
        return { count: data.length };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    account: {
      findMany: vi.fn(async () => [
        { id: 'acc-ar', code: '1-1200', name: 'AR', type: 'ASSET', isActive: true, isPostable: true },
        { id: 'acc-ap', code: '2-1000', name: 'AP', type: 'LIABILITY', isActive: true, isPostable: true },
        { id: 'acc-sales-return', code: '4-2000', name: 'Sales Return', type: 'REVENUE', isActive: true, isPostable: true },
        { id: 'acc-purchase-return', code: '5-2000', name: 'Purchase Return', type: 'EXPENSE', isActive: true, isPostable: true },
        { id: 'acc-cash', code: '1-1000', name: 'Cash', type: 'ASSET', isActive: true, isPostable: true },
      ]),
    },
    organizationAccountSettings: {
      findUnique: vi.fn(async () => ({
        arControlAccountId: 'acc-ar',
        apControlAccountId: 'acc-ap',
        arReturnAccountId: 'acc-sales-return',
        apReturnAccountId: 'acc-purchase-return',
      })),
    },
  };
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    creditNote: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    debitNote: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    journalEntry: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(async () => putExistingEntry),
    },
    journalLine: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    account: {
      findMany: vi.fn(async () => [
        { id: 'acc-ar', isPostable: true, isActive: true },
        { id: 'acc-cash', isPostable: true, isActive: true },
      ]),
    },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof txStub>) => Promise<unknown>) => cb(txStub())),
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
    nextNumber: vi.fn(async (_tx: unknown, model: string) => `${model.slice(0, 3).toUpperCase()}-0001`),
  };
});

vi.mock('@/lib/account-defaults', () => ({
  resolveAccountDefaultId: vi.fn((_accounts: unknown, _settings: unknown, key: string) => {
    const map: Record<string, string> = {
      arControl: 'acc-ar',
      apControl: 'acc-ap',
      arReturn: 'acc-sales-return',
      apReturn: 'acc-purchase-return',
    };
    return map[key] ?? null;
  }),
  loadOrgAccountDefaults: vi.fn(async () => ({})),
}));

vi.mock('@/lib/account-postings', () => ({
  syncAccountPostingFlags: vi.fn(async () => undefined),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { POST as createCreditNote } from '../credit-notes/route';
import { POST as createDebitNote } from '../debit-notes/route';
import { PUT as updateJournalEntry } from '../journal-entries/[id]/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function lastJournalEntryLines(): Array<{ debit: unknown; credit: unknown }> {
  const last = createCalls.journalEntry.at(-1);
  if (!last) throw new Error('no journalEntry.create call captured');
  const lines = (last.data as { lines: { create: Array<{ debit: unknown; credit: unknown }> } }).lines;
  return lines.create;
}

beforeEach(() => {
  createCalls.creditNote.length = 0;
  createCalls.debitNote.length = 0;
  createCalls.journalEntry.length = 0;
  createCalls.journalLine.length = 0;
  putUpdates.length = 0;
  putLineCreates.length = 0;
  putExistingEntry = null;
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/credit-notes — AR-side reversal posts a balanced JE', () => {
  it('creates a balanced DR Sales-Return / CR AR entry on a clean amount', async () => {
    const res = await createCreditNote(makeReq('/api/v1/credit-notes', 'POST', {
      customerId: 'cust-1',
      date: '2026-05-01',
      amount: 1000,
      reason: 'Customer return',
    }));
    expect(res.status).toBe(201);

    expect(createCalls.journalEntry).toHaveLength(1);
    const je = createCalls.journalEntry[0].data;
    expect(je.memo).toMatch(/Credit note/);
    expect(() => assertLinesBalanced(lastJournalEntryLines())).not.toThrow();
  });

  it('rounds float-mangled amounts to 2dp before persisting (0.1 + 0.2 family)', async () => {
    // Client passes a sum that JS computes to 99.99999999999999 due to drift
    // (e.g. summing 999×0.1). After our asMoney() write, the persisted
    // amount must be exactly 100.00 and the JE must still balance.
    let acc = 0;
    for (let i = 0; i < 999; i++) acc += 0.1;
    expect(acc).not.toBe(99.9);

    await createCreditNote(makeReq('/api/v1/credit-notes', 'POST', {
      customerId: 'cust-1',
      date: '2026-05-01',
      amount: acc, // ~99.89999999999...
    }));
    const cn = createCalls.creditNote[0].data;
    expect(cn.amount).toBe(99.9);
    expect(() => assertLinesBalanced(lastJournalEntryLines())).not.toThrow();
  });

  it('skips JE posting when amount rounds to zero', async () => {
    await createCreditNote(makeReq('/api/v1/credit-notes', 'POST', {
      customerId: 'cust-1',
      date: '2026-05-01',
      amount: 0,
    }));
    expect(createCalls.journalEntry).toHaveLength(0);
  });
});

describe('POST /api/v1/debit-notes — AP-side reversal posts a balanced JE', () => {
  it('creates a balanced DR AP / CR Purchase-Return entry', async () => {
    const res = await createDebitNote(makeReq('/api/v1/debit-notes', 'POST', {
      vendorId: 'v-1',
      date: '2026-05-01',
      amount: 250.5,
    }));
    expect(res.status).toBe(201);

    expect(createCalls.journalEntry).toHaveLength(1);
    expect(() => assertLinesBalanced(lastJournalEntryLines())).not.toThrow();
  });

  it('rounds float-mangled amounts before persist', async () => {
    await createDebitNote(makeReq('/api/v1/debit-notes', 'POST', {
      vendorId: 'v-1',
      date: '2026-05-01',
      amount: 0.1 + 0.2, // 0.30000000000000004
    }));
    const dn = createCalls.debitNote[0].data;
    expect(dn.amount).toBe(0.3);
    expect(() => assertLinesBalanced(lastJournalEntryLines())).not.toThrow();
  });
});

describe('PUT /api/v1/journal-entries/[id] — Decimal arithmetic on edit', () => {
  function makePutReq(id: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/v1/journal-entries/${id}`, {
      method: 'PUT',
      headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('balances under sub-cent float drift that Number() arithmetic would reject', async () => {
    putExistingEntry = {
      id: 'je-existing',
      status: 'DRAFT',
      organizationId: 'org-1',
      lines: [{ accountId: 'acc-ar' }],
    };
    // The lines below sum-as-Decimal to 100.00 / 100.00 exactly. Under the
    // pre-fix bare-Number arithmetic, JS would compute the credit sum as
    // 100.00000000000001 and trip the unbalanced guard. With Prisma.Decimal,
    // the sum is exact and the entry passes.
    const res = await updateJournalEntry(makePutReq('je-existing', {
      date: '2026-05-01',
      memo: 'Adjustment',
      source: 'ADJUSTMENT',
      status: 'DRAFT',
      lines: [
        { accountId: 'acc-ar', debit: '100.00', credit: 0 },
        { accountId: 'acc-cash', debit: 0, credit: '33.33' },
        { accountId: 'acc-cash', debit: 0, credit: '33.33' },
        { accountId: 'acc-cash', debit: 0, credit: '33.34' },
      ],
    }), { params: Promise.resolve({ id: 'je-existing' }) });

    expect(res.status).toBe(200);
    // Inspect the persisted totalDebit/totalCredit — must be exactly 100.
    const update = putUpdates[0];
    expect(String(update.totalDebit)).toBe('100');
    expect(String(update.totalCredit)).toBe('100');
  });

  it('rejects entries that are unbalanced beyond the half-cent tolerance', async () => {
    putExistingEntry = {
      id: 'je-existing',
      status: 'DRAFT',
      organizationId: 'org-1',
      lines: [{ accountId: 'acc-ar' }],
    };
    const res = await updateJournalEntry(makePutReq('je-existing', {
      date: '2026-05-01',
      memo: 'Bad',
      source: 'ADJUSTMENT',
      status: 'DRAFT',
      lines: [
        { accountId: 'acc-ar', debit: 100, credit: 0 },
        { accountId: 'acc-cash', debit: 0, credit: 99 },
      ],
    }), { params: Promise.resolve({ id: 'je-existing' }) });

    expect(res.status).toBe(422);
  });

  it('preserves precision on Decimal-shaped string inputs', async () => {
    putExistingEntry = {
      id: 'je-existing',
      status: 'DRAFT',
      organizationId: 'org-1',
      lines: [{ accountId: 'acc-ar' }],
    };
    const res = await updateJournalEntry(makePutReq('je-existing', {
      date: '2026-05-01',
      memo: 'Decimal',
      source: 'ADJUSTMENT',
      status: 'POSTED',
      lines: [
        { accountId: 'acc-ar', debit: '12345.67', credit: 0 },
        { accountId: 'acc-cash', debit: 0, credit: '12345.67' },
      ],
    }), { params: Promise.resolve({ id: 'je-existing' }) });

    expect(res.status).toBe(200);
    const update = putUpdates[0];
    // totalDebit / totalCredit must be Prisma.Decimal preserving full precision
    expect(update.totalDebit).toBeInstanceOf(Prisma.Decimal);
    expect(String(update.totalDebit)).toBe('12345.67');
    expect(String(update.totalCredit)).toBe('12345.67');
  });
});
