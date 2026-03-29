/**
 * React Query hooks for Sales Returns, Purchase Returns, Credit Notes, Debit Notes.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
  SalesReturn,    RawSalesReturn,
  PurchaseReturn, RawPurchaseReturn,
  CreditNote,     RawCreditNote,
  DebitNote,      RawDebitNote,
  CustomerCategory, RawCustomerCategory,
  Warehouse,
  ReturnStatus, CreditNoteStatus, DebitNoteStatus,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const RETURN_KEYS = {
  salesReturns:    (f?: Record<string, unknown>) => ['salesReturns', f ?? {}] as const,
  salesReturn:     (id: string) => ['salesReturns', id] as const,
  purchaseReturns: (f?: Record<string, unknown>) => ['purchaseReturns', f ?? {}] as const,
  purchaseReturn:  (id: string) => ['purchaseReturns', id] as const,
  creditNotes:     (f?: Record<string, unknown>) => ['creditNotes', f ?? {}] as const,
  creditNote:      (id: string) => ['creditNotes', id] as const,
  debitNotes:      (f?: Record<string, unknown>) => ['debitNotes', f ?? {}] as const,
  debitNote:       (id: string) => ['debitNotes', id] as const,
  warehouses:      ['warehouses'] as const,
};

export const CATEGORY_KEYS = {
  categories: ['customerCategories'] as const,
};

// ─── Status Maps ──────────────────────────────────────────────────────────────

const RETURN_STATUS_DOWN: Record<string, ReturnStatus> = {
  DRAFT: 'Draft', APPROVED: 'Approved', PENDING_NOTE: 'Pending Credit Note', VOID: 'Void',
};
const RETURN_STATUS_UP: Record<string, string> = {
  Draft: 'DRAFT', Approved: 'APPROVED',
  'Pending Credit Note': 'PENDING_NOTE', 'Pending Debit Note': 'PENDING_NOTE', Void: 'VOID',
};

const CN_STATUS_DOWN: Record<string, CreditNoteStatus> = { DRAFT: 'Draft', APPLIED: 'Applied', VOID: 'Void' };
const CN_STATUS_UP:   Record<string, string>           = { Draft: 'DRAFT', Applied: 'APPLIED', Void: 'VOID' };

const DN_STATUS_DOWN: Record<string, DebitNoteStatus>  = { DRAFT: 'Draft', APPLIED: 'Applied', VOID: 'Void' };
const DN_STATUS_UP:   Record<string, string>           = { Draft: 'DRAFT', Applied: 'APPLIED', Void: 'VOID' };

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeSalesReturn(raw: RawSalesReturn): SalesReturn {
  return {
    id:              raw.id,
    number:          raw.number || '',
    customerId:      raw.customerId || '',
    customerName:    raw.customer?.name || '',
    invoiceId:       raw.invoiceId || '',
    invoiceNumber:   raw.invoice?.number || '',
    returnDate:      raw.returnDate ? String(raw.returnDate).slice(0, 10) : '',
    warehouseId:     raw.warehouseId || '',
    arAccountId:     raw.arAccountId || '',
    returnAccountId: raw.returnAccountId || '',
    taxAccountId:    raw.taxAccountId || '',
    applyTax:        raw.applyTax ?? true,
    taxIncluded:     raw.taxIncluded ?? false,
    taxRate:         Number(raw.taxRate ?? 11),
    subtotal:        Number(raw.subtotal ?? 0),
    taxAmount:       Number(raw.taxAmount ?? 0),
    totalAmount:     Number(raw.totalAmount ?? 0),
    reason:          raw.reason || '',
    notes:           raw.notes || '',
    status:          RETURN_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as ReturnStatus) ?? 'Draft',
    lines: (raw.lines ?? []).map((l) => ({
      id:        l.id,
      itemId:    l.itemId || '',
      itemName:  l.itemName || l.item?.name || '',
      qtySold:   Number(l.qtySold ?? 0),
      qtyReturn: Number(l.qtyReturn ?? 0),
      unit:      l.unit || 'PCS',
      price:     Number(l.price ?? 0),
      lineTotal: Number(l.lineTotal ?? 0),
    })),
  };
}

function normalizePurchaseReturn(raw: RawPurchaseReturn): PurchaseReturn {
  return {
    id:              raw.id,
    number:          raw.number || '',
    vendorId:        raw.vendorId || '',
    vendorName:      raw.vendor?.name || '',
    billId:          raw.billId || '',
    billNumber:      raw.bill?.number || '',
    returnDate:      raw.returnDate ? String(raw.returnDate).slice(0, 10) : '',
    warehouseId:     raw.warehouseId || '',
    apAccountId:     raw.apAccountId || '',
    returnAccountId: raw.returnAccountId || '',
    taxAccountId:    raw.taxAccountId || '',
    applyTax:        raw.applyTax ?? true,
    taxIncluded:     raw.taxIncluded ?? false,
    taxRate:         Number(raw.taxRate ?? 11),
    subtotal:        Number(raw.subtotal ?? 0),
    taxAmount:       Number(raw.taxAmount ?? 0),
    totalAmount:     Number(raw.totalAmount ?? 0),
    reason:          raw.reason || '',
    notes:           raw.notes || '',
    status:          RETURN_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as ReturnStatus) ?? 'Draft',
    lines: (raw.lines ?? []).map((l) => ({
      id:           l.id,
      lineKey:      l.lineKey || '',
      itemId:       l.itemId || '',
      description:  l.description || l.item?.name || '',
      qtyPurchased: Number(l.qtyPurchased ?? 0),
      qtyReturn:    Number(l.qtyReturn ?? 0),
      unit:         l.unit || 'PCS',
      price:        Number(l.price ?? 0),
      lineTotal:    Number(l.lineTotal ?? 0),
    })),
  };
}

function normalizeCreditNote(raw: RawCreditNote): CreditNote {
  return {
    id:                  raw.id,
    number:              raw.number || '',
    salesReturnId:       raw.salesReturnId || '',
    returnId:            raw.salesReturnId || '',
    returnNumber:        raw.salesReturn?.number || '',
    customerId:          raw.customerId || '',
    customerName:        raw.customer?.name || '',
    sourceInvoiceId:     raw.sourceInvoiceId || '',
    sourceInvoiceNumber: raw.sourceInvoice?.number || '',
    date:                raw.date ? String(raw.date).slice(0, 10) : '',
    settlementType:      raw.settlementType === 'REFUND' ? 'Refund' : 'Apply to Invoice',
    settlementRef:       raw.settlementRef || '',
    refundBankId:        raw.refundBankAccountId || '',
    refundMethod:        raw.refundMethod || '',
    arAccountId:         raw.arAccountId || '',
    returnAccountId:     raw.returnAccountId || '',
    taxAccountId:        raw.taxAccountId || '',
    settlementAccountId: raw.settlementAccountId || '',
    applyTax:            raw.applyTax ?? true,
    amount:              Number(raw.amount ?? 0),
    note:                raw.note || '',
    status:              CN_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as CreditNoteStatus) ?? 'Draft',
  };
}

function normalizeDebitNote(raw: RawDebitNote): DebitNote {
  return {
    id:                  raw.id,
    number:              raw.number || '',
    purchaseReturnId:    raw.purchaseReturnId || '',
    returnId:            raw.purchaseReturnId || '',
    returnNumber:        raw.purchaseReturn?.number || '',
    vendorId:            raw.vendorId || '',
    vendorName:          raw.vendor?.name || '',
    sourceBillId:        raw.sourceBillId || '',
    sourceBillNumber:    raw.sourceBill?.number || '',
    date:                raw.date ? String(raw.date).slice(0, 10) : '',
    settlementType:      raw.settlementType === 'REFUND_FROM_VENDOR' ? 'Refund from Vendor' : 'Apply to Bill',
    settlementRef:       raw.settlementRef || '',
    refundBankId:        raw.refundBankAccountId || '',
    refundMethod:        raw.refundMethod || '',
    apAccountId:         raw.apAccountId || '',
    returnAccountId:     raw.returnAccountId || '',
    taxAccountId:        raw.taxAccountId || '',
    settlementAccountId: raw.settlementAccountId || '',
    applyTax:            raw.applyTax ?? true,
    amount:              Number(raw.amount ?? 0),
    note:                raw.note || '',
    status:              DN_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as DebitNoteStatus) ?? 'Draft',
  };
}

function normalizeCategory(raw: RawCustomerCategory): CustomerCategory {
  return {
    id:                  raw.id,
    name:                raw.name || '',
    prefix:              raw.prefix || '',
    defaultCreditLimit:  Number(raw.defaultCreditLimit ?? 0),
    defaultPaymentTerms: Number(raw.defaultPaymentTerms ?? 0),
    defaultDiscount:     Number(raw.defaultDiscount ?? 0),
    description:         raw.description || '',
    customerCount:       raw._count?.customers ?? 0,
  };
}

// ─── Sales Returns ────────────────────────────────────────────────────────────

export function useSalesReturns(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: RETURN_KEYS.salesReturns(filters),
    queryFn:  () => api.get<{ data?: RawSalesReturn[]; total?: number }>('/api/v1/sales-returns', filters).then((res) => ({
      data:  (res.data ?? []).map(normalizeSalesReturn),
      total: res.total ?? 0,
    })),
  });
}

export function useSalesReturn(id: string | undefined) {
  return useQuery({
    queryKey: RETURN_KEYS.salesReturn(id ?? ''),
    queryFn:  () => api.get<RawSalesReturn>(`/api/v1/sales-returns/${id}`).then(normalizeSalesReturn),
    enabled:  Boolean(id),
  });
}

export function useCreateSalesReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SalesReturn>) => api.post('/api/v1/sales-returns', {
      ...body,
      status: RETURN_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesReturns'] }),
  });
}

export function useUpdateSalesReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SalesReturn> & { id: string }) =>
      api.put(`/api/v1/sales-returns/${id}`, {
        ...body,
        ...(body.status && { status: RETURN_STATUS_UP[body.status] ?? body.status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesReturns'] }),
  });
}

// ─── Purchase Returns ─────────────────────────────────────────────────────────

export function usePurchaseReturns(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: RETURN_KEYS.purchaseReturns(filters),
    queryFn:  () => api.get<{ data?: RawPurchaseReturn[]; total?: number }>('/api/v1/purchase-returns', filters).then((res) => ({
      data:  (res.data ?? []).map(normalizePurchaseReturn),
      total: res.total ?? 0,
    })),
  });
}

export function usePurchaseReturn(id: string | undefined) {
  return useQuery({
    queryKey: RETURN_KEYS.purchaseReturn(id ?? ''),
    queryFn:  () => api.get<RawPurchaseReturn>(`/api/v1/purchase-returns/${id}`).then(normalizePurchaseReturn),
    enabled:  Boolean(id),
  });
}

export function useCreatePurchaseReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<PurchaseReturn>) => api.post('/api/v1/purchase-returns', {
      ...body,
      status: RETURN_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchaseReturns'] }),
  });
}

export function useUpdatePurchaseReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PurchaseReturn> & { id: string }) =>
      api.put(`/api/v1/purchase-returns/${id}`, {
        ...body,
        ...(body.status && { status: RETURN_STATUS_UP[body.status] ?? body.status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchaseReturns'] }),
  });
}

// ─── Credit Notes ─────────────────────────────────────────────────────────────

export function useCreditNotes(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: RETURN_KEYS.creditNotes(filters),
    queryFn:  () => api.get<{ data?: RawCreditNote[]; total?: number }>('/api/v1/credit-notes', filters).then((res) => ({
      data:  (res.data ?? []).map(normalizeCreditNote),
      total: res.total ?? 0,
    })),
  });
}

export function useCreditNote(id: string | undefined) {
  return useQuery({
    queryKey: RETURN_KEYS.creditNote(id ?? ''),
    queryFn:  () => api.get<RawCreditNote>(`/api/v1/credit-notes/${id}`).then(normalizeCreditNote),
    enabled:  Boolean(id),
  });
}

export function useCreateCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreditNote>) => api.post('/api/v1/credit-notes', {
      ...body,
      status:         CN_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
      settlementType: body.settlementType === 'Refund' ? 'REFUND' : 'APPLY_TO_INVOICE',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creditNotes'] }),
  });
}

export function useUpdateCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CreditNote> & { id: string }) =>
      api.put(`/api/v1/credit-notes/${id}`, {
        ...body,
        ...(body.status         && { status:         CN_STATUS_UP[body.status] ?? body.status }),
        ...(body.settlementType && { settlementType: body.settlementType === 'Refund' ? 'REFUND' : 'APPLY_TO_INVOICE' }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creditNotes'] }),
  });
}

export function useDeleteCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/credit-notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creditNotes'] }),
  });
}

// ─── Debit Notes ──────────────────────────────────────────────────────────────

export function useDebitNotes(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: RETURN_KEYS.debitNotes(filters),
    queryFn:  () => api.get<{ data?: RawDebitNote[]; total?: number }>('/api/v1/debit-notes', filters).then((res) => ({
      data:  (res.data ?? []).map(normalizeDebitNote),
      total: res.total ?? 0,
    })),
  });
}

export function useDebitNote(id: string | undefined) {
  return useQuery({
    queryKey: RETURN_KEYS.debitNote(id ?? ''),
    queryFn:  () => api.get<RawDebitNote>(`/api/v1/debit-notes/${id}`).then(normalizeDebitNote),
    enabled:  Boolean(id),
  });
}

export function useCreateDebitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<DebitNote>) => api.post('/api/v1/debit-notes', {
      ...body,
      status:         DN_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
      settlementType: body.settlementType === 'Refund from Vendor' ? 'REFUND_FROM_VENDOR' : 'APPLY_TO_BILL',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debitNotes'] }),
  });
}

export function useUpdateDebitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<DebitNote> & { id: string }) =>
      api.put(`/api/v1/debit-notes/${id}`, {
        ...body,
        ...(body.status         && { status:         DN_STATUS_UP[body.status] ?? body.status }),
        ...(body.settlementType && { settlementType: body.settlementType === 'Refund from Vendor' ? 'REFUND_FROM_VENDOR' : 'APPLY_TO_BILL' }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debitNotes'] }),
  });
}

export function useDeleteDebitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/debit-notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debitNotes'] }),
  });
}

// ─── Warehouses ───────────────────────────────────────────────────────────────

export function useWarehouses() {
  return useQuery({
    queryKey: RETURN_KEYS.warehouses,
    queryFn:  () => api.get<Warehouse[]>('/api/v1/warehouses').then((data) =>
      Array.isArray(data) ? data : []
    ),
    staleTime: 60_000,
  });
}

// ─── Customer Categories ──────────────────────────────────────────────────────

export function useCustomerCategories() {
  return useQuery({
    queryKey: CATEGORY_KEYS.categories,
    queryFn:  () => api.get<RawCustomerCategory[]>('/api/v1/customer-categories').then((data) =>
      Array.isArray(data) ? data.map(normalizeCategory) : []
    ),
  });
}

export function useCreateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CustomerCategory>) => api.post('/api/v1/customer-categories', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORY_KEYS.categories }),
  });
}

export function useUpdateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CustomerCategory> & { id: string }) =>
      api.put(`/api/v1/customer-categories/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORY_KEYS.categories }),
  });
}

export function useDeleteCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/customer-categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORY_KEYS.categories }),
  });
}
