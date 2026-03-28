import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
  ListResponse,
  Customer, RawCustomer,
  Invoice,  RawInvoice,
  ARPayment, RawARPayment,
  SalesOrder, RawSalesOrder,
  CustomerStatus, InvoiceStatus, PaymentStatus,
} from '../types';

export const AR_KEYS = {
    customers: ['customers'] as const,
    customer:  (id: string) => ['customers', id] as const,
    invoices:  ['arInvoices'] as const,
    invoice:   (id: string) => ['arInvoices', id] as const,
    payments:  ['arPayments'] as const,
    payment:   (id: string) => ['arPayments', id] as const,
};

// ── Status maps ───────────────────────────────────────────────────────────────

const CUSTOMER_STATUS_DOWN: Record<string, CustomerStatus> = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const CUSTOMER_STATUS_UP:   Record<string, string>         = { Active: 'ACTIVE', Inactive: 'INACTIVE' };

const INVOICE_STATUS_DOWN: Record<string, InvoiceStatus> = { DRAFT: 'Draft', SENT: 'Sent', PAID: 'Paid', OVERDUE: 'Overdue' };
const INVOICE_STATUS_UP:   Record<string, string>        = { Draft: 'DRAFT', Sent: 'SENT', Paid: 'PAID', Overdue: 'OVERDUE' };

const PAYMENT_STATUS_DOWN: Record<string, PaymentStatus> = { DRAFT: 'Draft', PROCESSING: 'Processing', COMPLETED: 'Completed', VOID: 'Void' };
const PAYMENT_STATUS_UP:   Record<string, string>        = { Draft: 'DRAFT', Processing: 'PROCESSING', Completed: 'COMPLETED', Void: 'VOID' };

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeCustomer(raw: RawCustomer): Customer {
    const category = raw.category;
    return {
        id:              raw.id,
        code:            raw.code            || '',
        name:            raw.name            || '',
        email:           raw.email           || '',
        phone:           raw.phone           || '',
        status:          CUSTOMER_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as CustomerStatus),
        category:        (typeof category === 'object' && category !== null ? category.name : category) || '',
        balance:         Number(raw.balance  ?? raw.openingBalance ?? 0),
        defaultDiscount: Number(raw.defaultDiscount ?? 0),
        paymentTerms:    Number(raw.paymentTermsDays ?? raw.paymentTerms ?? 0),
        creditLimit:     Number(raw.creditLimit ?? 0),
        useCategoryDefaults: raw.useCategoryDefaults ?? true,
        billingAddress:  raw.billingAddress  || '',
        shippingAddress: raw.shippingAddress || '',
    };
}

function normalizeInvoice(raw: RawInvoice): Invoice {
    return {
        id:           raw.id,
        number:       raw.number    || '',
        customerId:   raw.customerId || '',
        customerName: raw.customer?.name || '',
        customerCode: raw.customer?.code || '',
        issueDate:    raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        date:         raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        dueDate:      raw.dueDate   ? String(raw.dueDate).slice(0, 10)   : '',
        status:       INVOICE_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as InvoiceStatus),
        amount:       Number(raw.totalAmount    ?? 0),
        totalAmount:  Number(raw.totalAmount    ?? 0),
        subtotal:     Number(raw.subtotal       ?? 0),
        taxAmount:    Number(raw.taxAmount      ?? 0),
        discountAmount: Number(raw.discountAmount ?? 0),
        notes:        raw.notes     || '',
        poNumber:     raw.poNumber  || '',
        currency:     raw.currency  || 'IDR',
        createdById:  raw.createdById || raw.createdBy?.id || '',
        createdByName: raw.createdBy?.fullName || '',
        lines: (raw.lines || []).map((l) => ({
            ...l,
            price:        Number(l.price        ?? 0),
            quantity:     Number(l.quantity      ?? 0),
            lineSubtotal: Number(l.lineSubtotal  ?? 0),
            discountPct:  Number(l.discountPct   ?? 0),
        })),
    };
}

function normalizePayment(raw: RawARPayment): ARPayment {
    return {
        id:           raw.number || raw.id,
        _id:          raw.id,
        number:       raw.number || '',
        customerId:   raw.customerId || '',
        customerName: raw.customer?.name || '',
        date:         raw.date ? String(raw.date).slice(0, 10) : '',
        method:       raw.method     || '',
        amount:       Number(raw.totalAmount ?? 0),
        totalAmount:  Number(raw.totalAmount ?? 0),
        status:       PAYMENT_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as PaymentStatus),
        invoiceId:    raw.invoiceId  || '',
        bankId:       raw.bankId     || '',
    };
}

// ── Customers ─────────────────────────────────────────────────────────────────

export function useCustomers(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AR_KEYS.customers, filters],
        queryFn:  () => api.get<ListResponse<RawCustomer>>('/api/v1/customers', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeCustomer),
        }),
        staleTime: 30_000,
    });
}

export function useCreateCustomer() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<Customer>) => api.post('/api/v1/customers', {
            ...body,
            status: CUSTOMER_STATUS_UP[body.status ?? ''] ?? body.status,
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.customers }),
    });
}

export function useUpdateCustomer() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<Customer> & { id: string }) => api.put(`/api/v1/customers/${id}`, {
            ...updates,
            ...(updates.status && { status: CUSTOMER_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.customers }),
    });
}

export function useDeleteCustomer() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/customers/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.customers }),
    });
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export function useInvoices(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AR_KEYS.invoices, filters],
        queryFn:  () => api.get<ListResponse<RawInvoice>>('/api/v1/invoices', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeInvoice),
        }),
        staleTime: 30_000,
    });
}

export function useInvoice(id: string | undefined) {
    return useQuery({
        queryKey: AR_KEYS.invoice(id ?? ''),
        queryFn:  () => api.get<RawInvoice>(`/api/v1/invoices/${id}`),
        select:   normalizeInvoice,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: unknown) => api.post('/api/v1/invoices', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

export function useUpdateInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<Invoice> & { id: string }) => api.put(`/api/v1/invoices/${id}`, {
            ...updates,
            ...(updates.status && { status: INVOICE_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: AR_KEYS.invoices });
            qc.invalidateQueries({ queryKey: AR_KEYS.invoice(vars.id) });
        },
    });
}

export function useDeleteInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/invoices/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

// ── AR Payments ───────────────────────────────────────────────────────────────

export function useARPayments(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AR_KEYS.payments, filters],
        queryFn:  () => api.get<ListResponse<RawARPayment>>('/api/v1/ar-payments', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizePayment),
        }),
        staleTime: 30_000,
    });
}

export function useARPayment(id: string | undefined) {
    return useQuery({
        queryKey: AR_KEYS.payment(id ?? ''),
        queryFn:  () => api.get<RawARPayment>(`/api/v1/ar-payments/${id}`),
        select:   normalizePayment,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<ARPayment>) => api.post('/api/v1/ar-payments', {
            ...body,
            status: PAYMENT_STATUS_UP[body.status ?? ''] ?? body.status ?? 'COMPLETED',
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.payments }),
    });
}

export function useUpdateARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<ARPayment> & { id: string }) => api.put(`/api/v1/ar-payments/${id}`, {
            ...updates,
            ...(updates.status && { status: PAYMENT_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: AR_KEYS.payments });
            qc.invalidateQueries({ queryKey: AR_KEYS.payment(vars.id) });
        },
    });
}

export function useDeleteARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/ar-payments/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.payments }),
    });
}

// ── Sales Orders ──────────────────────────────────────────────────────────────

const SO_KEYS = { all: ['salesOrders'] as const };

const normalizeSO = (raw: RawSalesOrder): SalesOrder => ({
    id:           raw.id,
    number:       raw.number || raw.id,
    customerName: raw.customerName ?? undefined,
    customerId:   raw.customerId || '',
    issueDate:    raw.issueDate  ? raw.issueDate.slice(0, 10)  : '',
    expiryDate:   raw.expiryDate ? raw.expiryDate.slice(0, 10) : '',
    status:       (raw.status?.toLowerCase() ?? 'draft') as SalesOrder['status'],
    notes:        raw.notes    || '',
    invoiceId:    raw.invoiceId || null,
    items: (raw.items || []).map((i) => ({
        id:          i.id,
        productId:   i.productId   || '',
        code:        i.code        || '',
        description: i.description ?? undefined,
        quantity:    Number(i.quantity),
        unit:        i.unit        || 'PCS',
        price:       Number(i.price),
        discount:    Number(i.discount),
    })),
});

export const useSalesOrders = (params: Record<string, unknown> = {}) =>
    useQuery({
        queryKey: [...SO_KEYS.all, params],
        queryFn:  () => api.get<ListResponse<RawSalesOrder>>('/api/v1/sales-orders', params)
            .then((r) => ({ ...r, data: r.data.map(normalizeSO) })),
    });

export const useCreateSalesOrder = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: unknown) => api.post('/api/v1/sales-orders', data),
        onSuccess:  () => qc.invalidateQueries({ queryKey: SO_KEYS.all }),
    });
};

export const useUpdateSalesOrder = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
            api.put(`/api/v1/sales-orders/${id}`, data),
        onSuccess:  () => qc.invalidateQueries({ queryKey: SO_KEYS.all }),
    });
};

export const useDeleteSalesOrder = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/sales-orders/${id}`),
        onSuccess:  () => qc.invalidateQueries({ queryKey: SO_KEYS.all }),
    });
};

export const useConvertSOToInvoice = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (soId: string) => api.post(`/api/v1/sales-orders/${soId}/convert`),
        onSuccess:  () => {
            qc.invalidateQueries({ queryKey: SO_KEYS.all });
            qc.invalidateQueries({ queryKey: AR_KEYS.invoices });
        },
    });
};
