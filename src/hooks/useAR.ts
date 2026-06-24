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

const INVOICE_STATUS_DOWN: Record<string, InvoiceStatus> = { DRAFT: 'Draft', SENT: 'Sent', PAID: 'Paid', OVERDUE: 'Overdue', VOID: 'Void' };
const INVOICE_STATUS_UP:   Record<string, string>        = { Draft: 'DRAFT', Sent: 'SENT', Paid: 'PAID', Overdue: 'OVERDUE' };

const PAYMENT_METHOD_UP: Record<string, string> = {
    'Bank Transfer': 'BANK_TRANSFER', Check: 'CHECK', Cheque: 'CHECK',
    'Credit Card': 'CREDIT_CARD', Cash: 'CASH', COD: 'OTHER', 'E-Wallet': 'OTHER',
};
const mapPaymentMethodUp = (m?: string) => (m ? (PAYMENT_METHOD_UP[m] ?? (/^[A-Z_]+$/.test(m) ? m : 'OTHER')) : undefined);
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
    const lines = (raw.lines || []).map((l) => ({
        ...l,
        id: l.id || undefined,
        itemId: l.itemId || undefined,
        code: l.code || undefined,
        description: l.description || undefined,
        itemName: l.itemName || l.description || undefined,
        price:        Number(l.price        ?? 0),
        quantity:     Number(l.quantity      ?? 0),
        unit:         l.unit || 'PCS',
        lineSubtotal: Number(l.lineSubtotal  ?? 0),
        discountPct:  Number(l.discountPct   ?? 0),
        discount:     Number(l.discountPct   ?? 0),
    }));
    return {
        id:           raw.id,
        number:       raw.number    || '',
        customerId:   raw.customerId || '',
        customerName: raw.customer?.name || '',
        customerCode: raw.customer?.code || '',
        invoiceType:  raw.invoiceType || 'Sales Invoice',
        issueDate:    raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        date:         raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        dueDate:      raw.dueDate   ? String(raw.dueDate).slice(0, 10)   : '',
        shippingDate: raw.shippingDate ? String(raw.shippingDate).slice(0, 10) : '',
        status:       INVOICE_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as InvoiceStatus),
        amount:       Number(raw.totalAmount    ?? 0),
        totalAmount:  Number(raw.totalAmount    ?? 0),
        subtotal:     Number(raw.subtotal       ?? 0),
        taxAmount:    Number(raw.taxAmount      ?? 0),
        discountAmount: Number(raw.discountAmount ?? 0),
        discountPct:  Number(raw.discountPct ?? 0),
        email:        raw.email || '',
        billingAddress: raw.billingAddress || '',
        shippingAddress: raw.shippingAddress || '',
        notes:        raw.notes     || '',
        poNumber:     raw.poNumber  || '',
        currency:     raw.currency  || 'IDR',
        createdById:  raw.createdById || raw.createdBy?.id || '',
        createdByName: raw.createdBy?.fullName || '',
        lines,
        items: lines,
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
        depositAccountId: raw.depositAccountId || '',
        arAccountId: raw.arAccountId || '',
        discountAccountId: raw.discountAccountId || '',
        penaltyAccountId: raw.penaltyAccountId || '',
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
        mutationFn: ({ id, ...updates }: { id: string } & Record<string, unknown>) => api.put(`/api/v1/invoices/${id}`, {
            ...updates,
            ...(typeof updates.status === 'string' && { status: INVOICE_STATUS_UP[updates.status] ?? updates.status }),
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

export function useVoidInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post(`/api/v1/invoices/${id}/void`, {}),
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: AR_KEYS.invoices });
            qc.invalidateQueries({ queryKey: AR_KEYS.invoice(id) });
        },
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
        mutationFn: (body: Partial<ARPayment> & Record<string, unknown>) => api.post('/api/v1/ar-payments', {
            ...body,
            ...(typeof body.method === 'string' && { method: mapPaymentMethodUp(body.method) }),
            status: PAYMENT_STATUS_UP[body.status ?? ''] ?? body.status ?? 'COMPLETED',
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.payments }),
    });
}

export function useUpdateARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: { id: string } & Record<string, unknown>) => api.put(`/api/v1/ar-payments/${id}`, {
            ...updates,
            ...(typeof updates.method === 'string' && { method: mapPaymentMethodUp(updates.method) }),
            ...(typeof updates.status === 'string' && { status: PAYMENT_STATUS_UP[updates.status] ?? updates.status }),
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

export function useVoidARPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post(`/api/v1/ar-payments/${id}/void`, {}),
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: AR_KEYS.payments });
            qc.invalidateQueries({ queryKey: AR_KEYS.payment(id) });
            qc.invalidateQueries({ queryKey: AR_KEYS.invoices }); // settled invoices revert
        },
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

// ── Delivery Notes ────────────────────────────────────────────────────────────

export const DN_KEYS = {
    all:  ['deliveryNotes'] as const,
    one:  (id: string) => ['deliveryNotes', id] as const,
};

export interface DeliveryNoteLine {
    itemId: string;
    description?: string;
    qtyOrdered: number;
    qtyToDeliver: number;
    unit?: string;
}

export interface DeliveryNote {
    id: string;
    number?: string;
    salesOrderId: string;
    salesOrderNumber?: string;
    customerId?: string;
    customerName?: string;
    date: string;
    warehouseId?: string;
    warehouseName?: string;
    notes?: string;
    status: 'Draft' | 'Delivered' | 'Cancelled';
    lines?: DeliveryNoteLine[];
}

export const useDeliveryNotes = (filters: Record<string, unknown> = {}) =>
    useQuery({
        queryKey: [...DN_KEYS.all, filters],
        queryFn:  () => api.get<{ data: DeliveryNote[]; total?: number }>('/api/v1/delivery-notes', filters),
        select:   (res) => ({ ...res, data: res.data ?? [] }),
        staleTime: 30_000,
    });

export const useCreateDeliveryNote = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<DeliveryNote>) => api.post('/api/v1/delivery-notes', body),
        onSuccess:  () => qc.invalidateQueries({ queryKey: DN_KEYS.all }),
    });
};

// ── Approval workflow ─────────────────────────────────────────────────────────

export function useSubmitInvoiceApproval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (invoiceId: string) => api.post(`/api/v1/invoices/${invoiceId}/submit-approval`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

export function useApproveInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (invoiceId: string) => api.post(`/api/v1/invoices/${invoiceId}/approve`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

export function useRejectInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ invoiceId, note }: { invoiceId: string; note?: string }) => api.post(`/api/v1/invoices/${invoiceId}/reject`, { note }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_KEYS.invoices }),
    });
}

export function useSendInvoiceEmail() {
    return useMutation({
        mutationFn: ({ invoiceId, to, cc, message }: { invoiceId: string; to: string; cc?: string; message?: string }) =>
            api.post(`/api/v1/invoices/${invoiceId}/send-email`, { to, cc, message }),
    });
}

// ── Recurring Invoices ────────────────────────────────────────────────────────

export const AR_RECURRING_KEYS = {
    list: ['arRecurring'] as const,
    single: (id: string) => ['arRecurring', id] as const,
};

export function useRecurringInvoices(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AR_RECURRING_KEYS.list, filters],
        queryFn: () => api.get<any>('/api/v1/recurring-invoices', filters),
        staleTime: 30_000,
    });
}

export function useCreateRecurringInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Record<string, unknown>) => api.post('/api/v1/recurring-invoices', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_RECURRING_KEYS.list }),
    });
}

export function useUpdateRecurringInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: { id: string } & Record<string, unknown>) => api.put(`/api/v1/recurring-invoices/${id}`, updates),
        onSuccess: () => qc.invalidateQueries({ queryKey: AR_RECURRING_KEYS.list }),
    });
}

export function useGenerateRecurringInvoice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post<{ invoiceId: string; invoiceNumber: string; nextRunDate: string }>(`/api/v1/recurring-invoices/${id}/generate`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: AR_RECURRING_KEYS.list });
            qc.invalidateQueries({ queryKey: AR_KEYS.invoices });
        },
    });
}

// ── Approvals (shared) ────────────────────────────────────────────────────────

export function useApprovals(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: ['approvals', filters],
        queryFn: () => api.get<any>('/api/v1/approvals', filters),
        staleTime: 15_000,
    });
}
