/**
 * Concurrent-apply race tests for credit/debit note posting helpers.
 *
 * Background: when the helper writes `journalEntryId` back onto the note,
 * a true concurrent DRAFT → APPLIED race can have two transactions both
 * pass the up-front `if (cn.journalEntryId) return` check. The second
 * writer's `update` then trips the `@unique` constraint on
 * `journalEntryId` (Prisma error code P2002).
 *
 * The fix in `lib/{credit,debit}-note-posting.ts` catches that specific
 * P2002 (only when `meta.target` includes `journalEntryId`) and rethrows
 * as `ApiError(409)`. The PUT route handler's existing catch reads
 * `error.status` and surfaces it as a 409 response. The transaction
 * rolls back the second writer's JE.create, so no duplicate JE persists.
 *
 * Other P2002s (e.g. the `@@unique([organizationId, number])` constraint)
 * MUST still bubble up as a generic 500 — they're a different bug class.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// ── Mock state ────────────────────────────────────────────────────────────────

let creditNoteRow: { id: string; status: 'DRAFT' | 'APPLIED' | 'VOID'; journalEntryId: string | null } | null = null;
let debitNoteRow:  { id: string; status: 'DRAFT' | 'APPLIED' | 'VOID'; journalEntryId: string | null } | null = null;

// Per-test injection: when set, the next `tx.{credit,debit}Note.update`
// call that writes `journalEntryId` throws this error instead of succeeding.
let creditNoteUpdateThrows: Error | null = null;
let debitNoteUpdateThrows:  Error | null = null;

const txStub = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ max_seq: 50 }]),
  creditNote: {
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (creditNoteUpdateThrows && typeof data.journalEntryId === 'string') {
        const err = creditNoteUpdateThrows;
        creditNoteUpdateThrows = null;
        throw err;
      }
      if (creditNoteRow && typeof data.status === 'string') {
        creditNoteRow.status = data.status as 'DRAFT' | 'APPLIED' | 'VOID';
      }
      if (creditNoteRow && typeof data.journalEntryId === 'string') {
        creditNoteRow.journalEntryId = data.journalEntryId;
      }
      return { id: 'cn-1', ...data };
    }),
    findFirst: vi.fn(async () => (creditNoteRow ? { ...creditNoteRow } : null)),
    findUnique: vi.fn(async () => ({
      id: 'cn-1',
      number: 'CRN-0001',
      organizationId: 'org-1',
      date: new Date('2026-05-08'),
      amount: 1000,
      returnAccountId: null,
      arAccountId: null,
      journalEntryId: creditNoteRow?.journalEntryId ?? null,
    })),
  },
  debitNote: {
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (debitNoteUpdateThrows && typeof data.journalEntryId === 'string') {
        const err = debitNoteUpdateThrows;
        debitNoteUpdateThrows = null;
        throw err;
      }
      if (debitNoteRow && typeof data.status === 'string') {
        debitNoteRow.status = data.status as 'DRAFT' | 'APPLIED' | 'VOID';
      }
      if (debitNoteRow && typeof data.journalEntryId === 'string') {
        debitNoteRow.journalEntryId = data.journalEntryId;
      }
      return { id: 'dn-1', ...data };
    }),
    findFirst: vi.fn(async () => (debitNoteRow ? { ...debitNoteRow } : null)),
    findUnique: vi.fn(async () => ({
      id: 'dn-1',
      number: 'DBN-0001',
      organizationId: 'org-1',
      date: new Date('2026-05-08'),
      amount: 500,
      apAccountId: null,
      returnAccountId: null,
      journalEntryId: debitNoteRow?.journalEntryId ?? null,
    })),
  },
  journalEntry: {
    create: vi.fn(async () => ({ id: 'je-new', entryNo: 'JE-new' })),
  },
  account: {
    findMany: vi.fn(async () => [
      { id: 'acc-ar', isActive: true, isPostable: true, code: '1-1200', name: 'AR', type: 'ASSET' },
      { id: 'acc-ap', isActive: true, isPostable: true, code: '2-1000', name: 'AP', type: 'LIABILITY' },
      { id: 'acc-sales-return', isActive: true, isPostable: true, code: '4-2000', name: 'Sales Return', type: 'REVENUE' },
      { id: 'acc-purchase-return', isActive: true, isPostable: true, code: '5-2000', name: 'Purchase Return', type: 'EXPENSE' },
    ]),
  },
  organization: { findUnique: vi.fn(async () => ({ approvalRequirements: null })) },
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
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

vi.mock('@/lib/account-defaults', () => ({
  resolveAccountDefaultId: vi.fn((_a: unknown, _s: unknown, key: string) => {
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

import { PUT as updateCreditNote } from '../credit-notes/[id]/route';
import { PUT as updateDebitNote } from '../debit-notes/[id]/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePut(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function p2002(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: 'test', meta: { target } },
  );
}

beforeEach(() => {
  creditNoteRow = null;
  debitNoteRow = null;
  creditNoteUpdateThrows = null;
  debitNoteUpdateThrows = null;
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('credit notes — concurrent apply race', () => {
  it('returns 409 when a concurrent writer trips the journalEntryId unique constraint', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
    creditNoteUpdateThrows = p2002(['journalEntryId']);

    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already been posted/i);
  });

  it('still 500s on an unrelated P2002 (e.g. organizationId+number unique)', async () => {
    // Different unique constraint — this is a different bug class and
    // must NOT be misclassified as the race we're handling.
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
    creditNoteUpdateThrows = p2002(['organizationId', 'number']);

    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(500);
  });

  it('handles meta.target as a string (some Prisma versions/dialects)', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
    creditNoteUpdateThrows = p2002('CreditNote_journalEntryId_key');

    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(409);
  });
});

describe('debit notes — concurrent apply race', () => {
  it('returns 409 when a concurrent writer trips the journalEntryId unique constraint', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: null };
    debitNoteUpdateThrows = p2002(['journalEntryId']);

    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already been posted/i);
  });

  it('still 500s on an unrelated P2002', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: null };
    debitNoteUpdateThrows = p2002(['organizationId', 'number']);

    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(500);
  });

  it('handles meta.target as a string', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: null };
    debitNoteUpdateThrows = p2002('DebitNote_journalEntryId_key');

    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(409);
  });
});
