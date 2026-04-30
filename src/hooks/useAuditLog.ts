/**
 * React Query hooks for the audit log.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { AuditLog, RawAuditLog } from '../types';

export const AUDIT_KEYS = {
  logs: (filters?: Record<string, unknown>) => ['auditLogs', filters ?? {}] as const,
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
};

const ENTITY_LABELS: Record<string, string> = {
  SalesInvoice: 'Sales Invoice',
  Bill: 'Bill',
  ARPayment: 'AR Payment',
  APPayment: 'AP Payment',
  Customer: 'Customer',
  Vendor: 'Vendor',
  PurchaseOrder: 'Purchase Order',
  JournalEntry: 'Journal Entry',
  Account: 'Account',
  Item: 'Item',
  StockAdjustment: 'Stock Adjustment',
  BankAccount: 'Bank Account',
  BankTransaction: 'Bank Transaction',
  Employee: 'Employee',
  CreditNote: 'Credit Note',
  DebitNote: 'Debit Note',
  SalesReturn: 'Sales Return',
  PurchaseReturn: 'Purchase Return',
  CustomerCategory: 'Customer Category',
};

function normalizeAuditLog(raw: RawAuditLog): AuditLog {
  return {
    id:          raw.id,
    actorName:   raw.actor?.fullName || raw.actor?.name || raw.actor?.email || 'System',
    actorEmail:  raw.actor?.email || '',
    entityType:  raw.entityType  ?? '',
    entityLabel: ENTITY_LABELS[raw.entityType ?? ''] || raw.entityType || '',
    entityId:    raw.entityId    ?? '',
    action:      raw.action      ?? '',
    actionLabel: ACTION_LABELS[raw.action ?? ''] || raw.action || '',
    payload:     raw.payload,
    createdAt:   raw.createdAt,
  };
}

export function useAuditLogs(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: AUDIT_KEYS.logs(filters),
    queryFn: () =>
      api.get<{ data?: RawAuditLog[]; total?: number }>('/api/v1/audit-logs', filters).then((res) => ({
        data:  (res.data ?? []).map(normalizeAuditLog),
        total: res.total ?? 0,
      })),
    staleTime: 10_000,
  });
}
