/**
 * Tests for the `journal-entries/[id]` PUT path's Prisma.Decimal arithmetic.
 *
 * Background: this route used to do bare `Number(line.debit) || 0` and sum
 * with floats, so a legitimate balanced entry could trip the unbalanced
 * guard due to IEEE-754 drift (e.g. 33.33 + 33.33 + 33.34 != 100). The
 * fix routes line amounts through `Prisma.Decimal` end-to-end, which sums
 * exactly and matches the half-cent tolerance used by `lib/journal-posting.ts`.
 *
 * The credit-note / debit-note POST balance tests that used to live here
 * were removed when the lifecycle fix (#22) moved their JE posting from POST
 * to the DRAFT → APPLIED transition; that flow is now covered by
 * `notes-lifecycle.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

let putExistingEntry: { id: string; status: string; organizationId: string; lines: { accountId: string }[] } | null = null;
const putUpdates: Record<string, unknown>[] = [];
let periodLookupResult: Record<string, unknown> | null = null;
const journalCreateMock = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
  id: 'je-post-1',
  entryNo: 'JE-000100',
  totalDebit: data.totalDebit,
  totalCredit: data.totalCredit,
  status: data.status,
}));

const txStub = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ max_seq: 99 }]),
  $executeRaw: vi.fn(async () => 0),
  organization: {
    findUnique: vi.fn(async () => ({ id: 'org-1' })),
  },
  accountingPeriod: {
    findFirst: vi.fn(async () => periodLookupResult),
  },
  account: {
    findMany: vi.fn(async () => [
      { id: 'acc-ar', isPostable: true, isActive: true },
      { id: 'acc-cash', isPostable: true, isActive: true },
    ]),
  },
  journalEntry: {
    create: journalCreateMock,
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      putUpdates.push(data);
      return { id: 'je-put-1', ...data };
    }),
    findFirst: vi.fn(async () => putExistingEntry),
  },
  journalLine: {
    createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => ({ count: data.length })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    journalEntry: {
      findFirst: vi.fn(async () => putExistingEntry),
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
  return { ...actual, logAudit: vi.fn() };
});

vi.mock('@/lib/account-postings', () => ({
  syncAccountPostingFlags: vi.fn(async () => undefined),
}));

import { PUT as updateJournalEntry } from '../journal-entries/[id]/route';
import { POST as createJournalEntry } from '../journal-entries/route';

function makePostReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/journal-entries', {
    method: 'POST',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePutReq(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/journal-entries/${id}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  putUpdates.length = 0;
  putExistingEntry = null;
  periodLookupResult = null;
  journalCreateMock.mockClear();
  vi.clearAllMocks();
});

describe('PUT /api/v1/journal-entries/[id] — Prisma.Decimal arithmetic on edit', () => {
  it('rejects posted journal creation dated inside a closed period even without periodId', async () => {
    periodLookupResult = {
      name: 'May 2026',
      status: 'CLOSED',
      isLocked: false,
    };

    const res = await createJournalEntry(makePostReq({
      date: '2026-05-01',
      memo: 'Closed period entry',
      source: 'MANUAL',
      status: 'POSTED',
      lines: [
        { accountId: 'acc-ar', debit: 100, credit: 0 },
        { accountId: 'acc-cash', debit: 0, credit: 100 },
      ],
    }));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: 'Accounting period "May 2026" is closed/locked — cannot post on 2026-05-01',
    });
    expect(journalCreateMock).not.toHaveBeenCalled();
  });

  it('rejects posting an edited draft dated inside a closed period', async () => {
    putExistingEntry = {
      id: 'je-existing',
      status: 'DRAFT',
      organizationId: 'org-1',
      lines: [{ accountId: 'acc-ar' }],
    };
    periodLookupResult = {
      name: 'May 2026',
      status: 'CLOSED',
      isLocked: false,
    };

    const res = await updateJournalEntry(
      makePutReq('je-existing', {
        date: '2026-05-01',
        memo: 'Closed period update',
        source: 'MANUAL',
        status: 'POSTED',
        lines: [
          { accountId: 'acc-ar', debit: 100, credit: 0 },
          { accountId: 'acc-cash', debit: 0, credit: 100 },
        ],
      }),
      { params: Promise.resolve({ id: 'je-existing' }) },
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: 'Accounting period "May 2026" is closed/locked — cannot post on 2026-05-01',
    });
    expect(putUpdates).toHaveLength(0);
  });

  it('balances under sub-cent float drift that bare-Number arithmetic would reject', async () => {
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
    const res = await updateJournalEntry(
      makePutReq('je-existing', {
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
      }),
      { params: Promise.resolve({ id: 'je-existing' }) },
    );

    expect(res.status).toBe(200);
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
    const res = await updateJournalEntry(
      makePutReq('je-existing', {
        date: '2026-05-01',
        memo: 'Bad',
        source: 'ADJUSTMENT',
        status: 'DRAFT',
        lines: [
          { accountId: 'acc-ar', debit: 100, credit: 0 },
          { accountId: 'acc-cash', debit: 0, credit: 99 },
        ],
      }),
      { params: Promise.resolve({ id: 'je-existing' }) },
    );

    expect(res.status).toBe(422);
  });

  it('preserves precision on Decimal-shaped string inputs', async () => {
    putExistingEntry = {
      id: 'je-existing',
      status: 'DRAFT',
      organizationId: 'org-1',
      lines: [{ accountId: 'acc-ar' }],
    };
    const res = await updateJournalEntry(
      makePutReq('je-existing', {
        date: '2026-05-01',
        memo: 'Decimal',
        source: 'ADJUSTMENT',
        status: 'POSTED',
        lines: [
          { accountId: 'acc-ar', debit: '12345.67', credit: 0 },
          { accountId: 'acc-cash', debit: 0, credit: '12345.67' },
        ],
      }),
      { params: Promise.resolve({ id: 'je-existing' }) },
    );

    expect(res.status).toBe(200);
    const update = putUpdates[0];
    // totalDebit / totalCredit must be Prisma.Decimal preserving full precision.
    expect(update.totalDebit).toBeInstanceOf(Prisma.Decimal);
    expect(String(update.totalDebit)).toBe('12345.67');
    expect(String(update.totalCredit)).toBe('12345.67');
  });
});
