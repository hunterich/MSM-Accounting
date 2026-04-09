import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
  BillImportLine,
  BillImportReviewData,
  BillImportSession,
  RawBillImportLine,
  RawBillImportReviewData,
  RawBillImportSession,
  RawBillImportSuggestion,
} from '../types';

export const BILL_IMPORT_KEYS = {
  session: (id: string) => ['billImportSession', id] as const,
};

const normalizeSuggestion = (raw: RawBillImportSuggestion | null | undefined) => {
  if (!raw) return null;
  return {
    id: raw.id,
    label: raw.label || '',
    confidence: Number(raw.confidence ?? 0),
    reason: raw.reason || '',
  };
};

const normalizeLine = (raw: RawBillImportLine): BillImportLine => ({
  lineNo: Number(raw.lineNo ?? 0) || 1,
  rawText: raw.rawText || '',
  supplierLabel: raw.supplierLabel || '',
  supplierSku: raw.supplierSku || '',
  description: raw.description || '',
  quantity: Number(raw.quantity ?? 0),
  unit: raw.unit || 'PCS',
  price: Number(raw.price ?? 0),
  lineTotal: Number(raw.lineTotal ?? 0),
  itemId: raw.itemId || '',
  accountId: raw.accountId || '',
  itemSuggestion: normalizeSuggestion(raw.itemSuggestion),
  reviewStatus: raw.reviewStatus === 'matched' ? 'matched' : 'needs_review',
});

const normalizeReviewData = (raw: RawBillImportReviewData | null | undefined): BillImportReviewData | null => {
  if (!raw) return null;
  return {
    vendorId: raw.vendorId || '',
    vendorSuggestion: normalizeSuggestion(raw.vendorSuggestion),
    issueDate: raw.issueDate || '',
    dueDate: raw.dueDate || '',
    taxRate: Number(raw.taxRate ?? 0),
    taxAmount: Number(raw.taxAmount ?? 0),
    subtotal: Number(raw.subtotal ?? 0),
    totalAmount: Number(raw.totalAmount ?? 0),
    notes: raw.notes || '',
    lines: (raw.lines || []).map(normalizeLine),
    needsReviewCount: Number(raw.needsReviewCount ?? 0),
    readyToImport: Boolean(raw.readyToImport),
  };
};

const normalizeSession = (raw: RawBillImportSession): BillImportSession => ({
  id: raw.id,
  sourceFileName: raw.sourceFileName || '',
  sourceMimeType: raw.sourceMimeType || '',
  sourceFileSizeKb: Number(raw.sourceFileSizeKb ?? 0),
  sourceStorageKey: raw.sourceStorageKey || '',
  sourceText: raw.sourceText || '',
  extractionStatus: raw.extractionStatus || '',
  reviewStatus: raw.reviewStatus || '',
  vendorId: raw.vendorId || '',
  vendorConfidence: Number(raw.vendorConfidence ?? 0),
  vendorMatchReason: raw.vendorMatchReason || '',
  extractedData: raw.extractedData || null,
  normalizedData: normalizeReviewData(raw.normalizedData),
  vendor: raw.vendor ? {
    id: raw.vendor.id || '',
    name: raw.vendor.name || '',
    code: raw.vendor.code,
  } : null,
  createdBill: raw.createdBill ? {
    id: raw.createdBill.id || '',
    number: raw.createdBill.number || '',
    status: raw.createdBill.status || '',
  } : null,
  createdAt: raw.createdAt || '',
  updatedAt: raw.updatedAt || '',
});

export function useBillImportSession(id: string | undefined) {
  return useQuery({
    queryKey: BILL_IMPORT_KEYS.session(id ?? ''),
    queryFn: () => api.get<RawBillImportSession>(`/api/v1/bill-imports/${id}`),
    select: normalizeSession,
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateBillImport() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: FormData) => api.postForm<RawBillImportSession>('/api/v1/bill-imports', payload),
    onSuccess: (session) => {
      qc.setQueryData(BILL_IMPORT_KEYS.session(session.id), normalizeSession(session));
    },
  });
}

export function useUpdateBillImportSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reviewData }: { id: string; reviewData: BillImportReviewData }) =>
      api.put<RawBillImportSession>(`/api/v1/bill-imports/${id}`, { reviewData }),
    onSuccess: (session) => {
      qc.setQueryData(BILL_IMPORT_KEYS.session(session.id), normalizeSession(session));
    },
  });
}

export function useFinalizeBillImport() {
  return useMutation({
    mutationFn: ({ id, reviewData }: { id: string; reviewData: BillImportReviewData }) =>
      api.post<{ bill: { id: string; number: string; status: string } }>(`/api/v1/bill-imports/${id}/finalize`, { reviewData }),
  });
}
