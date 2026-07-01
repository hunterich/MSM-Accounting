/**
 * Credit-note and debit-note GL lifecycle tests.
 *
 * Original fix (#22) moved the JE posting from POST to the DRAFT → APPLIED
 * transition. Follow-up (this PR) adds DB-token idempotency now that
 * CreditNote/DebitNote have `journalEntryId` columns, plus edit/delete
 * guards on posted notes.
 *
 * Lifecycle contract (mirrors sales-return / purchase-return now):
 *   - POST always creates DRAFT, never books a JE
 *   - PUT DRAFT → APPLIED books exactly one balanced JE and stamps
 *     `journalEntryId` + `postedAt` on the note
 *   - PUT * → DRAFT is rejected once the note has left DRAFT
 *   - PUT on a posted note (any field beyond `status`) is rejected
 *   - DELETE on a posted note is rejected — must be voided first
 *
 * These tests run against a mocked Prisma so no DB is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared capture state ─────────────────────────────────────────────────────

const journalEntryCreates: Array<{ data: Record<string, unknown> }> = [];

type NoteRow = {
  id: string;
  status: 'DRAFT' | 'APPLIED' | 'VOID';
  journalEntryId: string | null;
};
let creditNoteRow: NoteRow | null = null;
let debitNoteRow: NoteRow | null = null;

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
      // Mutate the in-memory row so subsequent reads see the new state.
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
      date: new Date('2026-05-07'),
      amount: 1000,
      returnAccountId: null,
      arAccountId: null,
      journalEntryId: creditNoteRow?.journalEntryId ?? null,
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
      date: new Date('2026-05-07'),
      amount: 500,
      apAccountId: null,
      returnAccountId: null,
      journalEntryId: debitNoteRow?.journalEntryId ?? null,
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
  organization: { findUnique: vi.fn(async () => ({ approvalRequirements: null })) },
  // assertPeriodOpen() looks up the posting period; null = no period defined = open.
  accountingPeriod: { findFirst: vi.fn(async () => null) },
});

const deleteCalls = { creditNote: 0, debitNote: 0 };

vi.mock('@/lib/prisma', () => ({
  prisma: {
    creditNote: {
      findFirst: vi.fn(async () => (creditNoteRow ? { ...creditNoteRow } : null)),
      delete: vi.fn(async () => {
        deleteCalls.creditNote++;
        creditNoteRow = null;
        return { id: 'cn-1' };
      }),
    },
    debitNote: {
      findFirst: vi.fn(async () => (debitNoteRow ? { ...debitNoteRow } : null)),
      delete: vi.fn(async () => {
        deleteCalls.debitNote++;
        debitNoteRow = null;
        return { id: 'dn-1' };
      }),
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
import { PUT as updateCreditNote, DELETE as deleteCreditNote } from '../credit-notes/[id]/route';
import { POST as createDebitNote } from '../debit-notes/route';
import { PUT as updateDebitNote, DELETE as deleteDebitNote } from '../debit-notes/[id]/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePost(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePut(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDelete(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'DELETE',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' },
  });
}

beforeEach(() => {
  journalEntryCreates.length = 0;
  creditNoteRow = null;
  debitNoteRow = null;
  deleteCalls.creditNote = 0;
  deleteCalls.debitNote = 0;
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
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
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

  it('PUT APPLIED → APPLIED (status-only re-PATCH) does not duplicate the journal entry', async () => {
    creditNoteRow = { id: 'cn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT APPLIED → DRAFT is rejected so the note can never re-enter DRAFT and re-post', async () => {
    creditNoteRow = { id: 'cn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(422);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT DRAFT → VOID does not post a journal entry', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
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
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: null };
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

  it('PUT APPLIED → APPLIED (status-only) does not duplicate the journal entry', async () => {
    debitNoteRow = { id: 'dn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT APPLIED → DRAFT is rejected', async () => {
    debitNoteRow = { id: 'dn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(422);
    expect(journalEntryCreates).toHaveLength(0);
  });
});

// ── DB-token idempotency + edit/delete guards (this PR's new behavior) ───────

describe('credit notes — DB-token idempotency and edit/delete guards', () => {
  it('helper short-circuits when journalEntryId is already set: no second JE on a re-applied note', async () => {
    // Simulate the unlikely case where two PUT DRAFT→APPLIED requests
    // race past the status guard (e.g. concurrent transactions seeing
    // prior.status='DRAFT'). The second-mover finds the JE token set
    // and short-circuits inside the helper.
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: 'je-already-posted' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(200);
    // The helper read journalEntryId and short-circuited — no new JE.
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT on a posted note rejects edits to non-status fields with 422', async () => {
    creditNoteRow = { id: 'cn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { amount: 999, note: 'tampering' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/posted credit note/i);
  });

  it('PUT VOID → DRAFT is rejected (closes the VOID → DRAFT → APPLIED double-post gap)', async () => {
    creditNoteRow = { id: 'cn-1', status: 'VOID', journalEntryId: 'je-1' };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(422);
  });

  it('legacy fallback: posted note with null journalEntryId still blocked from edit', async () => {
    // No production data exists, but defense-in-depth: if some upstream
    // path ever marks a note APPLIED without setting journalEntryId,
    // the status check still triggers the edit guard.
    creditNoteRow = { id: 'cn-1', status: 'APPLIED', journalEntryId: null };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { amount: 100 }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(422);
  });

  it('DELETE on a DRAFT note succeeds', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
    const res = await deleteCreditNote(
      makeDelete('/api/v1/credit-notes/cn-1'),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(deleteCalls.creditNote).toBe(1);
  });

  it('DELETE on a posted note returns 422 — must be voided first', async () => {
    creditNoteRow = { id: 'cn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await deleteCreditNote(
      makeDelete('/api/v1/credit-notes/cn-1'),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(422);
    expect(deleteCalls.creditNote).toBe(0);
  });

  it('DRAFT note: PUT can edit amount and date freely', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
    const res = await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { amount: 250, note: 'still drafting' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(res.status).toBe(200);
  });
});

describe('debit notes — DB-token idempotency and edit/delete guards', () => {
  it('helper short-circuits when journalEntryId is already set', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: 'je-already-posted' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(journalEntryCreates).toHaveLength(0);
  });

  it('PUT on a posted note rejects edits to non-status fields with 422', async () => {
    debitNoteRow = { id: 'dn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { amount: 999 }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(422);
  });

  it('PUT VOID → DRAFT is rejected', async () => {
    debitNoteRow = { id: 'dn-1', status: 'VOID', journalEntryId: 'je-1' };
    const res = await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(422);
  });

  it('DELETE on a posted note returns 422', async () => {
    debitNoteRow = { id: 'dn-1', status: 'APPLIED', journalEntryId: 'je-1' };
    const res = await deleteDebitNote(
      makeDelete('/api/v1/debit-notes/dn-1'),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(422);
    expect(deleteCalls.debitNote).toBe(0);
  });

  it('DELETE on a DRAFT note succeeds', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: null };
    const res = await deleteDebitNote(
      makeDelete('/api/v1/debit-notes/dn-1'),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(res.status).toBe(200);
    expect(deleteCalls.debitNote).toBe(1);
  });
});

describe('credit notes — DRAFT → APPLIED writes the journalEntryId token', () => {
  it('after DRAFT → APPLIED, the in-memory note has journalEntryId set (idempotency token persisted)', async () => {
    creditNoteRow = { id: 'cn-1', status: 'DRAFT', journalEntryId: null };
    await updateCreditNote(
      makePut('/api/v1/credit-notes/cn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'cn-1' }) },
    );

    expect(journalEntryCreates).toHaveLength(1);
    // The helper called `tx.creditNote.update({ data: { journalEntryId, postedAt } })`
    // which our mock applied to the in-memory row.
    expect(creditNoteRow!.journalEntryId).toBe('je-1');
  });
});

describe('debit notes — DRAFT → APPLIED writes the journalEntryId token', () => {
  it('after DRAFT → APPLIED, the in-memory note has journalEntryId set', async () => {
    debitNoteRow = { id: 'dn-1', status: 'DRAFT', journalEntryId: null };
    await updateDebitNote(
      makePut('/api/v1/debit-notes/dn-1', { status: 'APPLIED' }),
      { params: Promise.resolve({ id: 'dn-1' }) },
    );

    expect(journalEntryCreates).toHaveLength(1);
    expect(debitNoteRow!.journalEntryId).toBe('je-1');
  });
});
