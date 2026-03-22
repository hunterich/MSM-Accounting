/**
 * React Query hooks for the Banking module.
 *
 * Field normalization:
 *   API BankAccount  → UI shape: currentBalance → balance, bankName → code
 *   API BankTransaction → UI shape: bankAccountId → accountId, type uppercase → lowercase
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const BANK_KEYS = {
  accounts: ['bankAccounts'],
  account:  (id) => ['bankAccounts', id],
  transactions: (filters) => ['bankTransactions', filters ?? {}],
  transaction:  (id) => ['bankTransactions', id],
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

const TYPE_DOWN = { INCOME: 'income', EXPENSE: 'expense', TRANSFER: 'transfer' };
const TYPE_UP   = { income: 'INCOME', expense: 'EXPENSE', transfer: 'TRANSFER' };

function normalizeAccount(raw) {
  return {
    id:               raw.id,
    name:             raw.name,
    code:             raw.bankName || raw.code || '',
    bankName:         raw.bankName || '',
    accountNumber:    raw.accountNumber || raw.last4 || '',
    balance:          Number(raw.currentBalance ?? raw.balance ?? 0),
    currency:         raw.currency || 'IDR',
    isActive:         raw.isActive ?? true,
    transactionCount: raw._count?.transactions ?? 0,
  };
}

function normalizeTxn(raw) {
  const type = raw.type ? (TYPE_DOWN[raw.type] ?? raw.type.toLowerCase()) : 'income';
  // Expenses are stored as positive in DB, displayed as negative in UI
  const amount = type === 'expense'
    ? -Math.abs(Number(raw.amount ?? 0))
    : Math.abs(Number(raw.amount ?? 0));
  return {
    id:          raw.id,
    date:        raw.date ? String(raw.date).slice(0, 10) : '',
    description: raw.description || '',
    amount,
    type,
    accountId:   raw.bankAccountId || raw.accountId || '',
    reference:   raw.reference || '',
    status:      raw.status || 'Unmatched',
    notes:       raw.notes || '',
    costCenter:  raw.costCenter || '',
    taxType:     raw.taxType || 'none',
    taxRate:     raw.taxRate ?? 0,
    bankAccount: raw.bankAccount || null,
    // action-specific fields
    toAccountId:      raw.toAccountId || '',
    payee:            raw.payee || '',
    expenseAccountId: raw.expenseAccountId || '',
    receivedFrom:     raw.receivedFrom || '',
    incomeAccountId:  raw.incomeAccountId || '',
  };
}

// ─── Account Hooks ────────────────────────────────────────────────────────────

/** Fetch all bank accounts for the current org */
export function useBankAccounts() {
  return useQuery({
    queryKey: BANK_KEYS.accounts,
    queryFn:  () => api.get('/api/v1/bank-accounts').then((data) =>
      Array.isArray(data) ? data.map(normalizeAccount) : []
    ),
  });
}

/** Create a new bank account */
export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData) => api.post('/api/v1/bank-accounts', {
      name:           formData.accountNickname,
      bankName:       formData.bankName,
      accountNumber:  formData.last4,
      currency:       formData.currency || 'IDR',
      currentBalance: Number(formData.openingBalance) || 0,
      isActive:       true,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEYS.accounts }),
  });
}

/** Update an existing bank account */
export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/api/v1/bank-accounts/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEYS.accounts }),
  });
}

/** Delete a bank account */
export function useDeleteBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/v1/bank-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEYS.accounts }),
  });
}

// ─── Transaction Hooks ────────────────────────────────────────────────────────

/**
 * Fetch bank transactions.
 * @param {Object} [filters] - { bankAccountId, type, page, limit }
 */
export function useBankTransactions(filters = {}) {
  return useQuery({
    queryKey: BANK_KEYS.transactions(filters),
    queryFn:  () => api.get('/api/v1/bank-transactions', filters).then((res) => ({
      data:  (res.data ?? []).map(normalizeTxn),
      total: res.total ?? 0,
      page:  res.page  ?? 1,
      limit: res.limit ?? 50,
    })),
  });
}

/**
 * Build the API payload from BankingActionForm state.
 * Maps UI field names → DB field names, lowercase type → uppercase enum.
 */
function buildTxnPayload(action, formData) {
  const amount = Math.abs(Number(formData.amount) || 0);
  const bankAccountId =
    action === 'transfer' ? formData.fromAccountId :
    action === 'expense'  ? formData.paidFromId    :
    formData.depositToId;

  return {
    bankAccountId,
    type:        TYPE_UP[action] ?? 'INCOME',
    amount,
    date:        formData.date,
    description: formData.description ||
                 `${action.charAt(0).toUpperCase() + action.slice(1)} — ${formData.reference || 'Manual entry'}`,
    reference:   formData.reference,
    notes:       formData.notes,
    costCenter:  formData.costCenter,
    taxType:     formData.taxType,
    taxRate:     formData.taxType !== 'none' ? Number(formData.taxRate) : 0,
    status:      'Unmatched',
    ...(action === 'transfer' ? { toAccountId:      formData.toAccountId }      : {}),
    ...(action === 'expense'  ? { payee:             formData.payee,
                                  expenseAccountId:  formData.expenseAccountId } : {}),
    ...(action === 'income'   ? { receivedFrom:      formData.receivedFrom,
                                  incomeAccountId:   formData.incomeAccountId }  : {}),
  };
}

/** Record a new banking transaction (income / expense / transfer) */
export function useCreateBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, formData }) =>
      api.post('/api/v1/bank-transactions', buildTxnPayload(action, formData)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
      qc.invalidateQueries({ queryKey: BANK_KEYS.accounts }); // balance updated by API
    },
  });
}

/** Update an existing transaction */
export function useUpdateBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/api/v1/bank-transactions/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
      qc.invalidateQueries({ queryKey: BANK_KEYS.accounts });
    },
  });
}

/** Delete a transaction */
export function useDeleteBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/v1/bank-transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
      qc.invalidateQueries({ queryKey: BANK_KEYS.accounts });
    },
  });
}
