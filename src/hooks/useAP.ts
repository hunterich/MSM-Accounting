import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
    ListResponse,
    Vendor,        RawVendor,
    VendorCategory, RawVendorCategory,
    Bill,          RawBill,
    APPayment,     RawAPPayment,
    PurchaseOrder, RawPurchaseOrder,
    VendorStatus, BillStatus, PaymentStatus, POStatus,
} from '../types';

export const AP_KEYS = {
    vendorCategories: ['apVendorCategories'] as const,
    vendors: ['apVendors'] as const,
    vendor: (id: string) => ['apVendors', id] as const,
    bills: ['apBills'] as const,
    bill: (id: string) => ['apBills', id] as const,
    payments: ['apPayments'] as const,
    payment: (id: string) => ['apPayments', id] as const,
    pos: ['apPOs'] as const,
    po: (id: string) => ['apPOs', id] as const,
};

// ── Status maps ───────────────────────────────────────────────────────────────

const VENDOR_STATUS_DOWN: Record<string, VendorStatus> = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const VENDOR_STATUS_UP:   Record<string, string>       = { Active: 'ACTIVE', Inactive: 'INACTIVE' };

// Bill: DRAFT|OPEN|PENDING|PAID|OVERDUE|VOID
// "OPEN" → "Unpaid" matches the UI filter option
const BILL_STATUS_DOWN: Record<string, BillStatus> = {
    DRAFT: 'Draft', OPEN: 'Unpaid', PENDING: 'Pending',
    PAID: 'Paid', OVERDUE: 'Overdue', VOID: 'Void',
};
const BILL_STATUS_UP: Record<string, string> = {
    Draft: 'DRAFT', Unpaid: 'OPEN', Pending: 'PENDING',
    Paid: 'PAID', Overdue: 'OVERDUE', Void: 'VOID',
};

const PAYMENT_STATUS_DOWN: Record<string, PaymentStatus> = { DRAFT: 'Draft', PROCESSING: 'Processing', COMPLETED: 'Completed', VOID: 'Void' };
const PAYMENT_STATUS_UP:   Record<string, string>        = { Draft: 'DRAFT', Processing: 'PROCESSING', Completed: 'COMPLETED', Void: 'VOID' };

// PO: DRAFT|PENDING_APPROVAL|APPROVED|PARTIAL_RECEIVED|CLOSED|CANCELLED
// "PARTIAL_RECEIVED" → "Billed" matches the UI filter option
const PO_STATUS_DOWN: Record<string, POStatus> = {
    DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved', PARTIAL_RECEIVED: 'Billed',
    CLOSED: 'Closed', CANCELLED: 'Cancelled',
};
const PO_STATUS_UP: Record<string, string> = {
    Draft: 'DRAFT', 'Pending Approval': 'PENDING_APPROVAL', Approved: 'APPROVED', Billed: 'PARTIAL_RECEIVED',
    Closed: 'CLOSED', Cancelled: 'CANCELLED',
};

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeVendor(raw: RawVendor): Vendor {
    return {
        id: raw.id,
        code: raw.code || '',
        name: raw.name || '',
        email: raw.email || '',
        phone: raw.phone || '',
        categoryId: raw.categoryId || raw.vendorCategory?.id || '',
        category: raw.vendorCategory?.name || raw.category || '',
        categoryCode: raw.vendorCategory?.code || '',
        paymentTerms: raw.paymentTerms || '',
        npwp: raw.npwp || '',
        defaultApAccountId: raw.defaultApAccountId || '',
        status: VENDOR_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as VendorStatus),
        balance: Number(raw.balance ?? 0),
        billingAddress: raw.billingAddress || '',
        shippingAddress: raw.shippingAddress || '',
    };
}

function normalizeVendorCategory(raw: RawVendorCategory): VendorCategory {
    return {
        id: raw.id,
        name: raw.name || '',
        code: raw.code || '',
        defaultPaymentTerms: raw.defaultPaymentTerms || '',
        defaultApAccountId: raw.defaultApAccountId || '',
        description: raw.description || '',
        isActive: raw.isActive ?? true,
        vendorCount: raw._count?.vendors ?? 0,
    };
}

function normalizeBill(raw: RawBill): Bill {
    return {
        id:         raw.number   || raw.id,
        _id:        raw.id,
        number:     raw.number   || '',
        vendorId:   raw.vendorId || '',
        vendor:     raw.vendor?.name || '',
        vendorName: raw.vendor?.name || '',
        vendorCode: raw.vendor?.code || '',
        date:       raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        issueDate:  raw.issueDate ? String(raw.issueDate).slice(0, 10) : '',
        due:        raw.dueDate  ? String(raw.dueDate).slice(0, 10)   : '',
        dueDate:    raw.dueDate  ? String(raw.dueDate).slice(0, 10)   : '',
        status:     BILL_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as BillStatus),
        amount:     Number(raw.totalAmount ?? 0),
        totalAmount: Number(raw.totalAmount ?? 0),
        subtotal:   Number(raw.subtotal    ?? 0),
        taxAmount:  Number(raw.taxAmount   ?? 0),
        apAccountId: raw.apAccountId || '',
        taxRate: Number(raw.taxRate ?? 0),
        poNumber:   raw.poNumber || '',
        notes:      raw.notes    || '',
        lines: (raw.lines || []).map((l) => ({
            ...l,
            id: l.id || undefined,
            itemId: typeof l.itemId === 'string' ? l.itemId : undefined,
            accountId: typeof l.accountId === 'string' ? l.accountId : undefined,
            description: typeof l.description === 'string' ? l.description : '',
            unit: typeof l.unit === 'string' ? l.unit : 'PCS',
            price:     Number(l.price     ?? 0),
            quantity:  Number(l.quantity  ?? 0),
            lineTotal: Number(l.lineTotal ?? 0),
        })),
        attachments: (raw.attachments || []).map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName || '',
            fileSizeKb: Number(attachment.fileSizeKb ?? 0),
            mimeType: attachment.mimeType || '',
            storageKey: attachment.storageKey || '',
            uploadedAt: attachment.uploadedAt ? String(attachment.uploadedAt) : '',
        })),
    };
}

function normalizeAPPayment(raw: RawAPPayment): APPayment {
    return {
        id:         raw.number || raw.id,
        _id:        raw.id,
        number:     raw.number   || '',
        vendorId:   raw.vendorId || '',
        vendorName: raw.vendor?.name || '',
        date:       raw.date ? String(raw.date).slice(0, 10) : '',
        method:     raw.method     || '',
        amount:     Number(raw.totalAmount ?? 0),
        totalAmount: Number(raw.totalAmount ?? 0),
        status:     PAYMENT_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as PaymentStatus),
        billId:     raw.billId  || '',
        bankId:     raw.bankId  || '',
        depositAccountId: raw.depositAccountId || '',
        apAccountId: raw.apAccountId || '',
        discountAccountId: raw.discountAccountId || '',
        penaltyAccountId: raw.penaltyAccountId || '',
    };
}

function normalizePO(raw: RawPurchaseOrder): PurchaseOrder {
    return {
        id:           raw.number || raw.id,
        _id:          raw.id,
        number:       raw.number   || '',
        vendorId:     raw.vendorId || '',
        vendorName:   raw.vendor?.name || '',
        vendorCode:   raw.vendor?.code || '',
        date:         raw.date         ? String(raw.date).slice(0, 10)         : '',
        expectedDate: raw.expectedDate ? String(raw.expectedDate).slice(0, 10) : '',
        status:       PO_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as POStatus),
        amount:       Number(raw.totalAmount ?? 0),
        totalAmount:  Number(raw.totalAmount ?? 0),
        notes:        raw.notes || '',
        lines: (raw.lines || []).map((l) => ({
            ...l,
            price:     Number(l.price     ?? 0),
            quantity:  Number(l.quantity  ?? 0),
            lineTotal: Number(l.lineTotal ?? 0),
        })),
    };
}

// ── Vendor Categories ─────────────────────────────────────────────────────────

export function useVendorCategories() {
    return useQuery({
        queryKey: AP_KEYS.vendorCategories,
        queryFn: () => api.get<RawVendorCategory[]>('/api/v1/vendor-categories').then((data) =>
            Array.isArray(data) ? data.map(normalizeVendorCategory) : []
        ),
        staleTime: 30_000,
    });
}

export function useCreateVendorCategory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<VendorCategory>) => api.post('/api/v1/vendor-categories', body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: AP_KEYS.vendorCategories });
            qc.invalidateQueries({ queryKey: AP_KEYS.vendors });
        },
    });
}

export function useUpdateVendorCategory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...body }: Partial<VendorCategory> & { id: string }) =>
            api.put(`/api/v1/vendor-categories/${id}`, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: AP_KEYS.vendorCategories });
            qc.invalidateQueries({ queryKey: AP_KEYS.vendors });
        },
    });
}

export function useDeleteVendorCategory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/vendor-categories/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: AP_KEYS.vendorCategories });
            qc.invalidateQueries({ queryKey: AP_KEYS.vendors });
        },
    });
}

// ── Vendors ───────────────────────────────────────────────────────────────────

export function useVendors(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AP_KEYS.vendors, filters],
        queryFn:  () => api.get<ListResponse<RawVendor>>('/api/v1/vendors', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeVendor),
        }),
        staleTime: 30_000,
    });
}

export function useCreateVendor() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<Vendor>) => api.post('/api/v1/vendors', {
            ...body,
            status: VENDOR_STATUS_UP[body.status ?? ''] ?? body.status,
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.vendors }),
    });
}

export function useUpdateVendor() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<Vendor> & { id: string }) => api.put(`/api/v1/vendors/${id}`, {
            ...updates,
            ...(updates.status && { status: VENDOR_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.vendors }),
    });
}

export function useDeleteVendor() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/vendors/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.vendors }),
    });
}

// ── Bills ─────────────────────────────────────────────────────────────────────

export function useBills(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AP_KEYS.bills, filters],
        queryFn:  () => api.get<ListResponse<RawBill>>('/api/v1/bills', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeBill),
        }),
        staleTime: 30_000,
    });
}

export function useBill(id: string | undefined) {
    return useQuery({
        queryKey: AP_KEYS.bill(id ?? ''),
        queryFn:  () => api.get<RawBill>(`/api/v1/bills/${id}`),
        select:   normalizeBill,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateBill() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<Bill>) => api.post('/api/v1/bills', {
            ...body,
            status: BILL_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.bills }),
    });
}

export function useUpdateBill() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<Bill> & { id: string }) => api.put(`/api/v1/bills/${id}`, {
            ...updates,
            ...(updates.status && { status: BILL_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: AP_KEYS.bills });
            qc.invalidateQueries({ queryKey: AP_KEYS.bill(vars.id) });
        },
    });
}

export function useDeleteBill() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/bills/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.bills }),
    });
}

// ── AP Payments ───────────────────────────────────────────────────────────────

export function useAPPayments(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AP_KEYS.payments, filters],
        queryFn:  () => api.get<ListResponse<RawAPPayment>>('/api/v1/ap-payments', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeAPPayment),
        }),
        staleTime: 30_000,
    });
}

export function useCreateAPPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<APPayment>) => api.post('/api/v1/ap-payments', {
            ...body,
            status: PAYMENT_STATUS_UP[body.status ?? ''] ?? body.status ?? 'COMPLETED',
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.payments }),
    });
}

export function useUpdateAPPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<APPayment> & { id: string }) => api.put(`/api/v1/ap-payments/${id}`, {
            ...updates,
            ...(updates.status && { status: PAYMENT_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: AP_KEYS.payments });
            qc.invalidateQueries({ queryKey: AP_KEYS.payment(vars.id) });
        },
    });
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

export function usePurchaseOrders(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...AP_KEYS.pos, filters],
        queryFn:  () => api.get<ListResponse<RawPurchaseOrder>>('/api/v1/purchase-orders', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizePO),
        }),
        staleTime: 30_000,
    });
}

export function usePurchaseOrder(id: string | undefined) {
    return useQuery({
        queryKey: AP_KEYS.po(id ?? ''),
        queryFn:  () => api.get<RawPurchaseOrder>(`/api/v1/purchase-orders/${id}`),
        select:   normalizePO,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreatePurchaseOrder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<PurchaseOrder>) => api.post('/api/v1/purchase-orders', {
            ...body,
            status: PO_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.pos }),
    });
}

export function useUpdatePurchaseOrder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<PurchaseOrder> & { id: string }) => api.put(`/api/v1/purchase-orders/${id}`, {
            ...updates,
            ...(updates.status && { status: PO_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: AP_KEYS.pos });
            qc.invalidateQueries({ queryKey: AP_KEYS.po(vars.id) });
        },
    });
}

// ── AP Reports ────────────────────────────────────────────────────────────────

export function useAPReport(params: Record<string, unknown>) {
    return useQuery({
        queryKey: ['apReport', params],
        queryFn: () => api.get<Record<string, unknown>>('/api/v1/reports/ap', params),
        enabled: !!params.type,
        staleTime: 60_000,
    });
}

// ── PO Actions ────────────────────────────────────────────────────────────────

export function useReceiveGoods() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ poId, lines, notes }: { poId: string; lines: { purchaseOrderLineId: string; qtyReceived: number }[]; notes?: string }) =>
            api.post<{ billId: string; billNumber: string }>(`/api/v1/purchase-orders/${poId}/receive`, { lines, notes }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: AP_KEYS.pos });
            qc.invalidateQueries({ queryKey: AP_KEYS.bills });
        },
    });
}

export function useClosePO() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (poId: string) => api.post(`/api/v1/purchase-orders/${poId}/close`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.pos }),
    });
}

export function useSubmitPOApproval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (poId: string) => api.post(`/api/v1/purchase-orders/${poId}/submit-approval`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.pos }),
    });
}

export function useApprovePO() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (poId: string) => api.post(`/api/v1/purchase-orders/${poId}/approve`),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.pos }),
    });
}

export function useRejectPO() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ poId, note }: { poId: string; note?: string }) => api.post(`/api/v1/purchase-orders/${poId}/reject`, { note }),
        onSuccess: () => qc.invalidateQueries({ queryKey: AP_KEYS.pos }),
    });
}
