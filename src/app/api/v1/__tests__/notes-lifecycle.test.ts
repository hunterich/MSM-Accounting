/**
 * Credit-note and debit-note GL lifecycle tests.
 *
 * Bug being fixed: previously the POST handler immediately posted a journal
 * entry whenever amount > 0, regardless of the schema-default DRAFT status —
 * so an unapproved draft was already hitting the ledger and bypassing
 * approval. The fix moves the posting to the DRAFT → APPLIED transition in
 * the [id] PUT handler, mirroring the sales-return / purchase-return flow.
 *
 * The CreditNote / DebitNote schemas have no `journalEntryId` column, so
 * idempotency is enforced at the transition boundary: DRAFT → APPLIED posts
 * once, and APPLIED → DRAFT is rejected (so the same note can never re-enter
 * DRAFT and trigger a duplicate post).
 *
 * These tests run against a mocked Prisma so no DB is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared capture state ─────────────────────────────────────────────────────

const journalEntryCreates: Array<{ data: Record<string, unknown> }> = [];

let creditNoteRow: { id: string; status: 'DRAFT' | 'APPLIED' | 'VOID' } | null = null;
let debitNoteRow: { id: string; status: 'DRAFT' | 'APPLIED' | 'VOID' } | null = null;

const txStub = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ max_seq: 50 }]),
  creditNote: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'cn-1',
      number: 'CRN-0001',
      organizationId: 'org-1',
      date: data.date ?? new Date('2026-05-07'),
      amount: data.amount ?? 0,
      status: data.status ?? 'DRAFT',
      returnAccountId: null,
      arAccountId: null,
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      // Mutate the in-memory row so subsequent reads see the new status.
      if (creditNoteRow && typeof data.status === 'string') {
        creditNoteRow.status = data.status as 'DRAFT' | 'APPLIED' | 'VOID';
      }
      return { id: 'cn-1', ...data };
    }),
    findFirst: vi.fn(async () => (creditNoteRow ? { ...creditNoteRow } : null)),
    findUnique: vi.fn(async () => ({
      id: 'cn-1',
      number: 'CRN-0001',
      organizationId: 'org-1',
      date: new Date('2026-05-07'),
      amount: 1000,
      returnAccountId: null,
      arAccountId: null,
    })),
  },
  debitNote: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'dn-1',
      number: 'DBN-0001',
      organizationId: 'org-1',
      date: data.date ?? new Date('2026-05-07'),
      amount: data.amount ?? 0,
      status: data.status ?? 'DRAFT',
      apAccountId: null,
      returnAccountId: null,
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (debitNoteRow && typeof data.status === 'string') {
        debitNoteRow.status = data.status as 'DRAFT' | 'APPLIED' | 'VOID';
      }
      return { id: 'dn-1', ...data };
    }),
    findFirst: vi.fn(async () => (debitNoteRow ? { ...debitNoteRow } : null)),
    findUnique: vi.fn(async () => ({
      id: 'dn-1',
      number: 'DBN-0001',
      organizationId: 'org-1',
      date: new Date('2026-05-07'),
      amount: 500,
      apAccountId: null,
      returnAccountId: null,
    })),
  },
  journalEntry: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      journalEntryCreates.push({ data });
      return { id: `je-${journalEntryCreates.length}`, entryNo: `JE-${journalEntryCreates.length}` };
    }),
  },
  account: {
    findMany: vi.fn(async () => [
      { id: 'acc-ar', isActive: true, isPostable: true, code: '1-1200', name: 'AR', type: 'ASSET' },
      { id: 'acc-ap', isActive: true, isPostable: true, code: '2-1000', name: 'AP', type: 'LIABILITY' },
      { id: 'acc-sales-return', isActive: true, isPostable: true, code: '4-2000', name: 'Sales Return', type: 'REVENUE' },
      { id: 'acc-purchase-return', isActive: true, isPostable: true, code: '5-2000', name: 'Purchase Return', type: 'EXPENSE' },
    ]),
  },
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    creditNote: { findFirst: vi.fn(async () => (creditNoteRow ? { ...creditNoteRow } : null)) },
    debitNote: { findFirst: vi.fn(async () => (debitNoteRow ? { ...debitNoteRow } : null)) },
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
    nextNumber: vi.fn(async (_tx: unknown, model: string) => {
      if (model === 'CreditNote') return 'CRN-0001';
      if (model === 'DebitNote') return 'DBN-0001';
      return 'X-0001';
    }),
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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { POST as createCreditNote } from '../credit-notes/route';
import { PUT as updateCreditNote } from '../credit-notes/[id]/route';
import { POST as createDebitNote } from '../debit-notes/route';
import { PUT as updateDebitNote } from '../debit-notes/[id]/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePost(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePut(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  journalEntryCreates.length = 0;
  creditNoteRow = null;
  debitNoteRow = null;
  vi.clearAllMocks();
});

// ── Credit notes ─────────────────────────────────────────────────────────────

describe('credit notes — GL lifecycle', () => {
  it('POST creates a DRAFT credit note and does NOT post a journal entry', async () => {
    const res = await createCreditNote(makePost('/api/v1/credit-notes', {
      customerId: 'cust-1',
      date: '2026-05-07',
      amount: 1000,
    }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('DRAFT');
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('POST forces status=DRAFT even if client tries to send status=APPLIED', async () => {
    await createCreditNote(makePost('/api/v1/credit-notes', {
      customerId: 'cust-1',
      date: '2026-05-07',
      amount: 1000,
      status: 'APPLIED', // attempt to bypass approval
    }));

    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT DRAFT → APPLIED books exactly one balanced journal entry', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(1);

    const je = journalEntryCreates[0].data as {
      memo: string;
      lines: { create: Array<{ debit: number; credit: number }> };
    };
    expect(je.memo).toMatch(/Credit note/);
    const lines = je.lines.create;
    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBe(credits);
  });

  it('PUT APPLIED → APPLIED (re-PATCH with same status) does not duplicate the journal entry', async () => {
    creditNoteRow = { id: 'cn-1', status: 'APPLIED' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED', note: 'updated' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT APPLIED → DRAFT is rejected so the note can never re-enter DRAFT and re-post', async () => {
    creditNoteRow = { id: 'cn-1', status: 'APPLIED' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(422);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT DRAFT → VOID does not post a journal entry', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT' };
    await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'VOID' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(journalEntryCreates).toHaveLength(0);
  });
});

// ── Debit notes ──────────────────────────────────────────────────────────────

describe('debit notes — GL lifecycle', () => {
  it('POST creates a DRAFT debit note and does NOT post a journal entry', async () => {
    const res = await createDebitNote(makePost('/api/v1/debit-notes', {
      vendorId: 'v-1',
      date: '2026-05-07',
      amount: 500,
    }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('DRAFT');
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('POST forces status=DRAFT even if client tries to send status=APPLIED', async () => {
    await createDebitNote(makePost('/api/v1/debit-notes', {
      vendorId: 'v-1',
      date: '2026-05-07',
      amount: 500,
      status: 'APPLIED',
    }));

    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT DRAFT → APPLIED books exactly one balanced journal entry', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(1);

    const je = journalEntryCreates[0].data as {
      memo: string;
      lines: { create: Array<{ debit: number; credit: number }> };
    };
    expect(je.memo).toMatch(/Debit note/);
    const lines = je.lines.create;
    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBe(credits);
  });

  it('PUT APPLIED → APPLIED does not duplicate the journal entry', async () => {
    debitNoteRow = { id: 'dn-1', status: 'APPLIED' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED', note: 'still applied' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT APPLIED → DRAFT is rejected', async () => {
    debitNoteRow = { id: 'dn-1', status: 'APPLIED' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(422);
    expect(journalEntryCreates).toHaveLength(0);
  });
});
