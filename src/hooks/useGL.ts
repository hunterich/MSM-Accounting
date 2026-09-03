/**
 * React Query hooks for the General Ledger module.
 *
 * Chart of Accounts
 *   GET  /api/v1/accounts          → ok(data)  → array directly
 *   POST /api/v1/accounts          → ok(account, 201)
 *   PUT  /api/v1/accounts/:id      → ok(account)
 *   DELETE /api/v1/accounts/:id    → ok({ deleted: true })
 *
 * Journal Entries
 *   GET  /api/v1/journal-entries   → listResponse → { data, total, page, limit }
 *   GET  /api/v1/journal-entries/:id → ok(entry)
 *   POST /api/v1/journal-entries   → { id, entryNo, totalDebit, totalCredit, status } (201)
 *   PUT  /api/v1/journal-entries/:id → ok(entry)  [DRAFT only]
 *   DELETE /api/v1/journal-entries/:id → ok({ deleted: true }) [DRAFT only]
 *
 * Field normalisation notes:
 *  - Account: API fields match UI fields; add hasChildren from _count.children
 *  - JournalEntry status: API 'DRAFT'/'POSTED' → UI 'Draft'/'Posted'
 *  - Decimal amounts come back as strings from Prisma over JSON; coerce to Number
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { fromPrismaAccountType, fromPrismaNormalSide } from '../../lib/account-rules';
import type {
  ListResponse,
  Account, RawAccount,
  JournalEntry, RawJournalEntry,
  JEStatus, JEFormHeader, JEFormLine,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const GL_KEYS = {
  accounts:       ['glAccounts'] as const,
  balances:       ['glAccounts', 'balances'] as const,
  account:        (id: string) => ['glAccounts', id] as const,
  journalEntries: (filters?: Record<string, unknown>) => ['journalEntries', filters ?? {}] as const,
  journalEntry:   (id: string) => ['journalEntries', id] as const,
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeAccount(raw: RawAccount): Account {
  const hasPostings = raw.journalLines
    ? raw.journalLines.length > 0
    : (raw.hasPostings ?? false);

  return {
    id:             raw.id,
    code:           raw.code  || '',
    name:           raw.name  || '',
    type:           raw.type ? fromPrismaAccountType(raw.type) : 'Asset',
    parentId:       raw.parentId || null,
    isPostable:     raw.isPostable  ?? true,
    isActive:       raw.isActive    ?? true,
    reportGroup:    raw.reportGroup    || '',
    reportSubGroup: raw.reportSubGroup || '',
    normalSide:     raw.normalSide ? fromPrismaNormalSide(raw.normalSide) : '',
    hasPostings,
    hasChildren: (raw._count?.children ?? 0) > 0,
    level: raw.level ?? 0,
    depth: raw.depth ?? 0,
  };
}

const STATUS_DOWN: Record<string, JEStatus> = { DRAFT: 'Draft', POSTED: 'Posted' };
const STATUS_UP:   Record<string, string>   = { Draft: 'DRAFT', Posted: 'POSTED' };

/**
 * Entry type ("source"): the form's <select> uses Title case ('Manual',
 * 'Adjustment', …) while the API's `createJournalEntryInputSchema` accepts the
 * UPPER_SNAKE enum only ('MANUAL', 'ADJUSTMENT', …). Map in both directions so
 * the form round-trips an existing entry and the API accepts what the form
 * sends — a 'Manual' source used to fail every save with a bare 400.
 */
export const toApiJESource = (source: string | null | undefined): string => {
  const trimmed = String(source ?? '').trim();
  return (trimmed || 'Manual').toUpperCase();
};
export const fromApiJESource = (source: string | null | undefined): string => {
  const trimmed = String(source ?? '').trim();
  if (!trimmed) return 'Manual';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

function normalizeJE(raw: RawJournalEntry): JournalEntry {
  return {
    id:          raw.id,
    entryNo:     raw.entryNo    || '',
    date:        raw.date ? String(raw.date).slice(0, 10) : '',
    memo:        raw.memo       || '',
    source:      fromApiJESource(raw.source),
    status:      STATUS_DOWN[raw.status ?? ''] ?? (raw.status as JEStatus) ?? 'Draft',
    totalDebit:  Number(raw.totalDebit  ?? 0),
    totalCredit: Number(raw.totalCredit ?? 0),
    periodId:    raw.periodId   || null,
    postedAt:    raw.postedAt   || null,
    lines: (raw.lines ?? []).map((l) => ({
      id:          l.id,
      lineNo:      l.lineNo,
      accountId:   l.accountId ?? '',
      description: l.description || '',
      debit:       Number(l.debit  ?? 0),
      credit:      Number(l.credit ?? 0),
      account:     l.account || null,
    })),
  };
}

// ─── Chart of Accounts Hooks ──────────────────────────────────────────────────

/**
 * The whole chart of accounts. Every form that posts to the GL resolves its
 * account defaults against this list, so it has to be complete: `/api/v1/accounts`
 * paginates at 20 by default, and a partial list silently drops accounts from
 * the pickers and makes default resolution fall back to the wrong account.
 */
/** Matches the accounts route's maxLimit — a chart of accounts is a bounded
 *  reference list, not a feed, so every consumer wants all of it. */
const ACCOUNT_FETCH_LIMIT = 1000;

export function useChartOfAccounts(filters?: Record<string, unknown>) {
  const query = { limit: ACCOUNT_FETCH_LIMIT, ...filters };
  return useQuery({
    queryKey: filters ? [...GL_KEYS.accounts, filters] : GL_KEYS.accounts,
    queryFn:  () =>
      api.get<RawAccount[] | { data: RawAccount[] }>('/api/v1/accounts', query).then((res) => {
        const rows = Array.isArray(res) ? res : (res?.data ?? []);
        return rows.map(normalizeAccount);
      }),
  });
}

/**
 * Fetch accounts filtered by one or more account types. Used by pickers (e.g.
 * the shop mapping modal) that need a long list of a specific category. The
 * accounts endpoint returns `{ data, total, page, limit }`, so we unwrap it
 * and merge results across types.
 */
export function useAccountsByType(types: string | string[], opts: { limit?: number; enabled?: boolean } = {}) {
  const list = Array.isArray(types) ? types : [types];
  const limit = opts.limit ?? ACCOUNT_FETCH_LIMIT;
  const enabled = opts.enabled ?? true;

  return useQuery({
    queryKey: [...GL_KEYS.accounts, { types: list, limit }],
    enabled,
    queryFn: async () => {
      const results = await Promise.all(
        list.map((t) =>
          api.get<{ data: RawAccount[] } | RawAccount[]>('/api/v1/accounts', { type: t, limit })
            .then((res) => Array.isArray(res) ? res : (res?.data ?? []))
        )
      );
      const seen = new Set<string>();
      return results.flat()
        .filter((a) => {
          if (!a?.id || seen.has(a.id)) return false;
          seen.add(a.id);
          return true;
        })
        .map(normalizeAccount)
        .filter((a) => a.isActive && a.isPostable);
    },
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Account>) => api.post('/api/v1/accounts', body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: GL_KEYS.accounts }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Account> & { id: string }) =>
      api.put(`/api/v1/accounts/${id}`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: GL_KEYS.accounts }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/accounts/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: GL_KEYS.accounts }),
  });
}

/**
 * Net debit balance per account over POSTED entries, for the chart's Balance
 * column (`GET /api/v1/accounts/balances`). Headers are rolled up client-side.
 * Always refetched on mount: a journal posted a moment ago must show.
 */
export function useAccountBalances() {
  return useQuery({
    queryKey: GL_KEYS.balances,
    queryFn: () => api.get<{ asOfDate: string | null; balances: Record<string, number> }>('/api/v1/accounts/balances'),
    staleTime: 0,
  });
}

// ─── Journal Entry Hooks ──────────────────────────────────────────────────────

export function useJournalEntries(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: GL_KEYS.journalEntries(filters),
    queryFn:  () =>
      api.get<ListResponse<RawJournalEntry>>('/api/v1/journal-entries', filters).then((res) => ({
        data:  (res.data ?? []).map(normalizeJE),
        total: res.total ?? 0,
        page:  res.page  ?? 1,
        limit: res.limit ?? 20,
      })),
  });
}

export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: GL_KEYS.journalEntry(id ?? ''),
    queryFn:  () =>
      api.get<RawJournalEntry>(`/api/v1/journal-entries/${id}`).then(normalizeJE),
    enabled: Boolean(id),
  });
}

/**
 * Shape the form state into the POST/PUT body. Exported for the unit test that
 * checks the result against the server's own zod schema — the two drifted
 * apart once (Title-case source, `description: null`) and the form could not
 * save at all.
 */
export function buildJEPayload(header: JEFormHeader, lines: JEFormLine[], status: JEStatus) {
  return {
    date:   header.date,
    memo:   header.memo,
    source: toApiJESource(header.source),
    status: STATUS_UP[status] ?? 'DRAFT',
    lines: lines
      .filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0)
      .map((l) => {
        // The schema's `description` is an optional string: null is rejected.
        const description = String(l.description ?? '').trim();
        return {
          accountId:   l.accountId,
          ...(description ? { description } : {}),
          debit:       Number(l.debit)  || 0,
          credit:      Number(l.credit) || 0,
        };
      }),
  };
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ header, lines, status }: { header: JEFormHeader; lines: JEFormLine[]; status: JEStatus }) =>
      api.post('/api/v1/journal-entries', buildJEPayload(header, lines, status)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journalEntries'] }),
  });
}

export function useUpdateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, header, lines, status }: { id: string; header: JEFormHeader; lines: JEFormLine[]; status: JEStatus }) =>
      api.put(`/api/v1/journal-entries/${id}`, buildJEPayload(header, lines, status)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journalEntries'] }),
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/journal-entries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journalEntries'] }),
  });
}
