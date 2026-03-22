import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export const INV_KEYS = {
    items:       ['invItems'],
    item:        (id) => ['invItems', id],
    adjustments: ['invAdjustments'],
    adjustment:  (id) => ['invAdjustments', id],
};

// ── Status / Type maps ────────────────────────────────────────────────────────

const ADJ_TYPE_DOWN   = { QUANTITY: 'Quantity', VALUE: 'Value' };
const ADJ_TYPE_UP     = { Quantity: 'QUANTITY', Value: 'VALUE' };

const ADJ_STATUS_DOWN = { DRAFT: 'Draft', APPROVED: 'Approved' };
const ADJ_STATUS_UP   = { Draft: 'DRAFT', Approved: 'APPROVED' };

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeItem(raw) {
    const stock = Number(raw.openingStock ?? raw.stockQty ?? raw.stock ?? 0);
    return {
        id:       raw.id,
        sku:      raw.sku      || '',
        name:     raw.name     || '',
        type:     raw.type     || '',
        category: raw.category || '',
        stock,
        cost:  Number(raw.cost  ?? 0),
        price: Number(raw.price ?? 0),
        unit:  raw.unit || 'PCS',
        notes: raw.notes || '',
        // Compute stock status (mirrors Inventory.jsx getStockStatus)
        status: stock === 0 ? 'Out of Stock' : stock < 5 ? 'Low Stock' : 'In Stock',
    };
}

function normalizeAdjustment(raw) {
    return {
        // Use ADJ number as display id
        id:     raw.number || raw.id,
        _id:    raw.id,
        number: raw.number || '',
        date:   raw.date ? String(raw.date).slice(0, 10) : '',
        type:   ADJ_TYPE_DOWN[raw.type] ?? raw.type,
        reason: raw.reason || '',
        notes:  raw.notes  || '',
        status: ADJ_STATUS_DOWN[raw.status] ?? raw.status,
        lines:  (raw.lines || []).map((l) => ({
            ...l,
            oldQty:     Number(l.oldQty     ?? 0),
            newQty:     Number(l.newQty     ?? 0),
            qtyDiff:    Number(l.qtyDiff    ?? 0),
            unitCost:   Number(l.unitCost   ?? 0),
            totalValue: Number(l.totalValue ?? 0),
        })),
    };
}

// ── Items ─────────────────────────────────────────────────────────────────────

export function useItems(filters = {}) {
    return useQuery({
        queryKey: [...INV_KEYS.items, filters],
        queryFn:  () => api.get('/api/v1/items', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeItem),
        }),
        staleTime: 30_000,
    });
}

export function useItem(id) {
    return useQuery({
        queryKey: INV_KEYS.item(id),
        queryFn:  () => api.get(`/api/v1/items/${id}`),
        select:   normalizeItem,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api.post('/api/v1/items', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.items }),
    });
}

export function useUpdateItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }) => api.put(`/api/v1/items/${id}`, updates),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: INV_KEYS.items });
            qc.invalidateQueries({ queryKey: INV_KEYS.item(vars.id) });
        },
    });
}

export function useDeleteItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.delete(`/api/v1/items/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.items }),
    });
}

// ── Stock Adjustments ─────────────────────────────────────────────────────────

export function useStockAdjustments(filters = {}) {
    return useQuery({
        queryKey: [...INV_KEYS.adjustments, filters],
        queryFn:  () => api.get('/api/v1/stock-adjustments', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeAdjustment),
        }),
        staleTime: 30_000,
    });
}

export function useCreateStockAdjustment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api.post('/api/v1/stock-adjustments', {
            ...body,
            type:   ADJ_TYPE_UP[body.type]   ?? body.type   ?? 'QUANTITY',
            status: ADJ_STATUS_UP[body.status] ?? body.status ?? 'DRAFT',
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: INV_KEYS.adjustments });
            qc.invalidateQueries({ queryKey: INV_KEYS.items }); // stock levels change
        },
    });
}

export function useUpdateStockAdjustment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }) => api.put(`/api/v1/stock-adjustments/${id}`, {
            ...updates,
            ...(updates.type   && { type:   ADJ_TYPE_UP[updates.type]   ?? updates.type }),
            ...(updates.status && { status: ADJ_STATUS_UP[updates.status] ?? updates.status }),
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: INV_KEYS.adjustments });
            qc.invalidateQueries({ queryKey: INV_KEYS.items });
        },
    });
}
