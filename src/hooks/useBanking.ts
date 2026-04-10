/**
 * React Query hooks for the Banking module.
 *
 * Field normalization:
 *   API BankAccount  → UI shape: currentBalance → balance, bankName → code
 *   API BankTransaction → UI shape: bankAccountId → accountId, type uppercase → lowercase
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
  BankAccount, RawBankAccount,
  BankTransaction, RawBankTransaction,
  TxnType, BankAccountFormData, BankTxnFormData,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const BANK_KEYS = {
  accounts:     ['bankAccounts'] as const,
  account:      (id: string) => ['bankAccounts', id] as const,
  transactions: (filters?: Record<string, unknown>) => ['bankTransactions', filters ?? {}] as const,
  transaction:  (id: string) => ['bankTransactions', id] as const,
  statements:   (bankAccountId?: string) => ['bankStatements', bankAccountId ?? ''] as const,
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

const TYPE_DOWN: Record<string, TxnType> = { INCOME: 'income', EXPENSE: 'expense', TRANSFER: 'transfer' };
const TYPE_UP:   Record<string, string>  = { income: 'INCOME', expense: 'EXPENSE', transfer: 'TRANSFER' };

function normalizeAccount(raw: RawBankAccount): BankAccount {
  return {
    id:               raw.id,
    name:             raw.name ?? '',
    code:             raw.bankName || raw.code || '',
    bankName:         raw.bankName || '',
    accountNumber:    raw.accountNumber || raw.last4 || '',
    balance:          Number(raw.currentBalance ?? raw.balance ?? 0),
    currency:         raw.currency || 'IDR',
    isActive:         raw.isActive ?? true,
    transactionCount: raw._count?.transactions ?? 0,
  };
}

function normalizeTxn(raw: RawBankTransaction): BankTransaction {
  const type = raw.type ? (TYPE_DOWN[raw.type] ?? (raw.type.toLowerCase() as TxnType)) : 'income';
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
    taxRate:     Number(raw.taxRate ?? 0),
    bankAccount: raw.bankAccount || null,
    toAccountId:      raw.toAccountId || '',
    payee:            raw.payee || '',
    expenseAccountId: raw.expenseAccountId || '',
    receivedFrom:     raw.receivedFrom || '',
    incomeAccountId:  raw.incomeAccountId || '',
  };
}

// ─── Account Hooks ────────────────────────────────────────────────────────────

export function useBankAccounts() {
  return useQuery({
    queryKey: BANK_KEYS.accounts,
    queryFn:  () => api.get<RawBankAccount[]>('/api/v1/bank-accounts').then((data) =>
      Array.isArray(data) ? data.map(normalizeAccount) : []
    ),
  });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: BankAccountFormData) => api.post('/api/v1/bank-accounts', {
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

export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<BankAccount> & { id: string }) =>
      api.put(`/api/v1/bank-accounts/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEYS.accounts }),
  });
}

export function useDeleteBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/bank-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEYS.accounts }),
  });
}

// ─── Transaction Hooks ────────────────────────────────────────────────────────

export function useBankTransactions(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: BANK_KEYS.transactions(filters),
    queryFn:  () => api.get<{ data?: RawBankTransaction[]; total?: number; page?: number; limit?: number }>(
      '/api/v1/bank-transactions', filters
    ).then((res) => ({
      data:  (res.data ?? []).map(normalizeTxn),
      total: res.total ?? 0,
      page:  res.page  ?? 1,
      limit: res.limit ?? 50,
    })),
  });
}

function buildTxnPayload(action: TxnType, formData: BankTxnFormData) {
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

export function useCreateBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, formData }: { action: TxnType; formData: BankTxnFormData }) =>
      api.post('/api/v1/bank-transactions', buildTxnPayload(action, formData)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
      qc.invalidateQueries({ queryKey: BANK_KEYS.accounts });
    },
  });
}

export function useUpdateBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<BankTransaction> & { id: string }) =>
      api.put(`/api/v1/bank-transactions/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
      qc.invalidateQueries({ queryKey: BANK_KEYS.accounts });
    },
  });
}

export function useDeleteBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/bank-transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
      qc.invalidateQueries({ queryKey: BANK_KEYS.accounts });
    },
  });
}

// ─── Bank Statement Hooks ─────────────────────────────────────────────────────

export interface BankStatementLine {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: 'Matched' | 'Unmatched';
  matchedTxnId?: string;
}

export interface BankStatement {
  id: string;
  bankAccountId: string;
  fileName?: string;
  importedAt?: string;
  lines: BankStatementLine[];
}

export function useBankStatements(bankAccountId?: string) {
  return useQuery({
    queryKey: BANK_KEYS.statements(bankAccountId),
    queryFn:  () => api.get<{ data?: BankStatement[] } | BankStatement[]>(
      '/api/v1/bank-statements',
      bankAccountId ? { bankAccountId } : undefined
    ),
    select: (res) => (Array.isArray(res) ? res : (res.data ?? [])),
    staleTime: 30_000,
  });
}

export function useImportBankStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => api.postForm<BankStatement>('/api/v1/bank-statements', formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bankStatements'] }),
  });
}

export function useAutoMatch(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/v1/bank-statements/match?statementId=${statementId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankStatements'] });
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
    },
  });
}

export function useManualMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ statementLineId, txnId }: { statementLineId: string; txnId: string }) =>
      api.post('/api/v1/bank-statements/manual-match', { statementLineId, txnId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankStatements'] });
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
    },
  });
}
