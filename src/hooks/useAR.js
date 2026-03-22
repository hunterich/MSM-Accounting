import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export const AR_KEYS = {
    customers: ['customers'],
    customer:  (id) => ['customers', id],
    invoices:  ['arInvoices'],
    invoice:   (id) => ['arInvoices', id],
    payments:  ['arPayments'],
    payment:   (id) => ['arPayments', id],
};

// ── Status maps ───────────────────────────────────────────────────────────────

const CUSTOMER_STATUS_DOWN = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const CUSTOMER_STATUS_UP   = { Active: 'ACTIVE', Inactive: 'INACTIVE' };

const INVOICE_STATUS_DOWN  = { DRAFT: 'Draft', SENT: 'Sent', PAID: 'Paid', OVERDUE: 'Overdue' };
const INVOICE_STATUS_UP    = { Draft: 'DRAFT', Sent: 'SENT', Paid: 'PAID', Overdue: 'OVERDUE' };

const PAYMENT_STATUS_DOWN  = { DRAFT: 'Draft', PROCESSING: 'Processing', COMPLETED: 'Completed', VOID: 'Void' };
const PAYMENT_STATUS_UP    = { Draft: 'DRAFT', Processing: 'PROCESSING', Completed: 'COMPLETED', Void: 'VOID' };

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeCustomer(raw) {
    return {
        id:              raw.id,
        code:            raw.code            || '',
        name:            raw.name            || '',
        email:           raw.email           || '',
        phone:           raw.phone           || '',
        status:          CUSTOMER_STATUS_DOWN[raw.status] ?? raw.status,
        // Fields not yet in API — default to safe values
        category:        raw.category        || '',
        balance:         Number(raw.balance  ?? 0),
        defaultDiscount: Number(raw.defaultDiscount ?? 0),
        paymentTerms:    Number(raw.paymentTerms    ?? 0),
        billingAddress:  raw.billingAddress  || '',
        shippingAddress: raw.shippingAddress || '',
    };
}

function normalizeInvoice(raw) {
    return {
        id:           raw.id,
        number:       raw.number    || '',
        customerId:   raw.customerId || '',
        customerName: raw.customer?.name || '',
        customerCode: raw.customer?.code || '',
        issueDate:    raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        // keep .date as alias so InvoiceWorkbench date-range filter still works
        date:         raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        dueDate:      raw.dueDate   ? String(raw.dueDate).slice(0, 10)   : '',
        status:       INVOICE_STATUS_DOWN[raw.status] ?? raw.status,
        amount:       Number(raw.totalAmount    ?? 0),
        totalAmount:  Number(raw.totalAmount    ?? 0),
        subtotal:     Number(raw.subtotal       ?? 0),
        taxAmount:    Number(raw.taxAmount      ?? 0),
        discountAmount: Number(raw.discountAmount ?? 0),
        notes:        raw.notes     || '',
        poNumber:     raw.poNumber  || '',
        currency:     raw.currency  || 'IDR',
        lines: (raw.lines || []).map((l) => ({
            ...l,
            price:        Number(l.price        ?? 0),
            quantity:     Number(l.quantity      ?? 0),
            lineSubtotal: Number(l.lineSubtotal  ?? 0),
            discountPct:  Number(l.discountPct   ?? 0),
        })),
    };
}

function normalizePayment(raw) {
    return {
        // Use ARP-number as display ID to match existing UI (payment.id shown in tabs/columns)
        id:           raw.number || raw.id,
        _id:          raw.id,                          // DB primary key for mutations
        number:       raw.number || '',
        customerId:   raw.customerId || '',
        customerName: raw.customer?.name || '',
        date:         raw.date ? String(raw.date).slice(0, 10) : '',
        method:       raw.method     || '',
        amount:       Number(raw.totalAmount ?? 0),
        totalAmount:  Number(raw.totalAmount ?? 0),
        status:       PAYMENT_STATUS_DOWN[raw.status] ?? raw.status,
        invoiceId:    raw.invoiceId  || '',
        bankId:       raw.bankId     || '',
    };
}

// ── Customers ─────────────────────────────────────────────────────────────────

export function useCustomers(filters = {}) {
    return useQuery({
        queryKey: [...AR_KEYS.customers, filters],
        queryFn:  () => api.get('/api/v1/customers', filters),
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
        mutationFn: (body) => api.post('/api/v1/customers', {
            ...body,
            status: CUSTOMER_STATUS_UP[body.status] ?? body.status,
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.customers }),
    });
}

export function useUpdateCustomer() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }) => api.put(`/api/v1/customers/${id}`, {
            ...updates,
            ...(updates.status && { status: CUSTOMER_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.customers }),
    });
}

export function useDeleteCustomer() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.delete(`/api/v1/customers/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.customers }),
    });
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export function useInvoices(filters = {}) {
    return useQuery({
        queryKey: [...AR_KEYS.invoices, filters],
        queryFn:  () => api.get('/api/v1/invoices', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeInvoice),
        }),
        staleTime: 30_000,
    });
}

export function useInvoice(id) {
    return useQuery({
        queryKey: AR_KEYS.invoice(id),
        queryFn:  () => api.get(`/api/v1/invoices/${id}`),
        select:   normalizeInvoice,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api.post('/api/v1/invoices', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

export function useUpdateInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }) => api.put(`/api/v1/invoices/${id}`, {
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
        mutationFn: (id) => api.delete(`/api/v1/invoices/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

// ── AR Payments ───────────────────────────────────────────────────────────────

export function useARPayments(filters = {}) {
    return useQuery({
        queryKey: [...AR_KEYS.payments, filters],
        queryFn:  () => api.get('/api/v1/ar-payments', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizePayment),
        }),
        staleTime: 30_000,
    });
}

export function useARPayment(id) {
    return useQuery({
        queryKey: AR_KEYS.payment(id),
        queryFn:  () => api.get(`/api/v1/ar-payments/${id}`),
        select:   normalizePayment,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api.post('/api/v1/ar-payments', {
            ...body,
            status: PAYMENT_STATUS_UP[body.status] ?? body.status ?? 'COMPLETED',
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.payments }),
    });
}

export function useUpdateARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }) => api.put(`/api/v1/ar-payments/${id}`, {
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
        mutationFn: (id) => api.delete(`/api/v1/ar-payments/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.payments }),
    });
}
