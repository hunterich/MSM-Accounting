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

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const GL_KEYS = {
  accounts:       ['glAccounts'],
  account:        (id) => ['glAccounts', id],
  journalEntries: (filters) => ['journalEntries', filters ?? {}],
  journalEntry:   (id) => ['journalEntries', id],
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeAccount(raw) {
  return {
    // Core fields
    id:             raw.id,
    code:           raw.code  || '',
    name:           raw.name  || '',
    type:           raw.type  || 'Asset',
    parentId:       raw.parentId || null,
    isPostable:     raw.isPostable  ?? true,
    isActive:       raw.isActive    ?? true,
    reportGroup:    raw.reportGroup    || '',
    reportSubGroup: raw.reportSubGroup || '',
    normalSide:     raw.normalSide  || '',
    // Derived
    hasChildren: (raw._count?.children ?? 0) > 0,
    // hasPostings: not returned by API yet; set false so API delete will guard it
    hasPostings: false,
    // Tree fields populated by buildAccountTree / flattenTree utilities
    level: raw.level ?? 0,
    depth: raw.depth ?? 0,
  };
}

const STATUS_DOWN = { DRAFT: 'Draft', POSTED: 'Posted' };
const STATUS_UP   = { Draft: 'DRAFT', Posted: 'POSTED' };

function normalizeJE(raw) {
  return {
    id:          raw.id,
    entryNo:     raw.entryNo    || '',
    date:        raw.date ? String(raw.date).slice(0, 10) : '',
    memo:        raw.memo       || '',
    source:      raw.source     || 'Manual',
    status:      STATUS_DOWN[raw.status] ?? raw.status ?? 'Draft',
    totalDebit:  Number(raw.totalDebit  ?? 0),
    totalCredit: Number(raw.totalCredit ?? 0),
    periodId:    raw.periodId   || null,
    postedAt:    raw.postedAt   || null,
    lines: (raw.lines ?? []).map((l) => ({
      id:          l.id,
      lineNo:      l.lineNo,
      accountId:   l.accountId,
      description: l.description || '',
      debit:       Number(l.debit  ?? 0),
      credit:      Number(l.credit ?? 0),
      account:     l.account || null,
    })),
  };
}

// ─── Chart of Accounts Hooks ──────────────────────────────────────────────────

/**
 * Fetch all accounts for the current org.
 * @param {Object} [filters] – { type, search }
 */
export function useChartOfAccounts(filters) {
  return useQuery({
    queryKey: filters ? [...GL_KEYS.accounts, filters] : GL_KEYS.accounts,
    queryFn:  () =>
      api.get('/api/v1/accounts', filters).then((data) =>
        Array.isArray(data) ? data.map(normalizeAccount) : []
      ),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/api/v1/accounts', body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: GL_KEYS.accounts }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/api/v1/accounts/${id}`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: GL_KEYS.accounts }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/v1/accounts/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: GL_KEYS.accounts }),
  });
}

// ─── Journal Entry Hooks ──────────────────────────────────────────────────────

/**
 * Paginated journal entry list.
 * @param {Object} [filters] – { status, page, limit }
 */
export function useJournalEntries(filters = {}) {
  return useQuery({
    queryKey: GL_KEYS.journalEntries(filters),
    queryFn:  () =>
      api.get('/api/v1/journal-entries', filters).then((res) => ({
        data:  (res.data ?? []).map(normalizeJE),
        total: res.total ?? 0,
        page:  res.page  ?? 1,
        limit: res.limit ?? 20,
      })),
  });
}

/** Fetch a single journal entry by ID. */
export function useJournalEntry(id) {
  return useQuery({
    queryKey: GL_KEYS.journalEntry(id),
    queryFn:  () =>
      api.get(`/api/v1/journal-entries/${id}`).then(normalizeJE),
    enabled: Boolean(id),
  });
}

/**
 * Build the API payload from the form state.
 * @param {Object} header – { date, memo, source }
 * @param {Array}  lines  – [{ accountId, description, debit, credit }]
 * @param {string} status – 'Draft' | 'Posted'
 */
function buildJEPayload(header, lines, status) {
  return {
    date:   header.date,
    memo:   header.memo,
    source: header.source,
    status: STATUS_UP[status] ?? 'DRAFT',
    lines: lines
      .filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0)
      .map((l) => ({
        accountId:   l.accountId,
        description: l.description || null,
        debit:       Number(l.debit)  || 0,
        credit:      Number(l.credit) || 0,
      })),
  };
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ header, lines, status }) =>
      api.post('/api/v1/journal-entries', buildJEPayload(header, lines, status)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journalEntries'] }),
  });
}

export function useUpdateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, header, lines, status }) =>
      api.put(`/api/v1/journal-entries/${id}`, buildJEPayload(header, lines, status)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journalEntries'] }),
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/v1/journal-entries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journalEntries'] }),
  });
}
