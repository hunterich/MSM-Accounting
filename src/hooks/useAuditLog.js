/**
 * React Query hooks for the audit log.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export const AUDIT_KEYS = {
  logs: (filters) => ['auditLogs', filters ?? {}],
};

const ACTION_LABELS = {
  CREATE: 'Buat',
  UPDATE: 'Ubah',
  DELETE: 'Hapus',
};

const ENTITY_LABELS = {
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

function normalizeAuditLog(raw) {
  return {
    id: raw.id,
    actorName: raw.actor?.name || raw.actor?.email || 'System',
    actorEmail: raw.actor?.email || '',
    entityType: raw.entityType,
    entityLabel: ENTITY_LABELS[raw.entityType] || raw.entityType,
    entityId: raw.entityId,
    action: raw.action,
    actionLabel: ACTION_LABELS[raw.action] || raw.action,
    payload: raw.payload,
    createdAt: raw.createdAt,
  };
}

export function useAuditLogs(filters = {}) {
  return useQuery({
    queryKey: AUDIT_KEYS.logs(filters),
    queryFn: () =>
      api.get('/api/v1/audit-logs', filters).then((res) => ({
        data: (res.data ?? []).map(normalizeAuditLog),
        total: res.total ?? 0,
      })),
    staleTime: 10_000,
  });
}
