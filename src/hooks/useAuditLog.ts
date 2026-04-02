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
  CREATE: 'Buat',
  UPDATE: 'Ubah',
  DELETE: 'Hapus',
};

const ENTITY_LABELS: Record<string, string> = {
  SalesInvoice: 'Faktur Penjualan',
  Bill: 'Tagihan',
  ARPayment: 'Pembayaran AR',
  APPayment: 'Pembayaran AP',
  Customer: 'Pelanggan',
  Vendor: 'Vendor',
  PurchaseOrder: 'Pesanan Pembelian',
  JournalEntry: 'Jurnal',
  Account: 'Akun',
  Item: 'Barang',
  StockAdjustment: 'Penyesuaian Stok',
  BankAccount: 'Rekening Bank',
  BankTransaction: 'Transaksi Bank',
  Employee: 'Karyawan',
  CreditNote: 'Nota Kredit',
  DebitNote: 'Nota Debit',
  SalesReturn: 'Retur Penjualan',
  PurchaseReturn: 'Retur Pembelian',
  CustomerCategory: 'Kategori Pelanggan',
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
