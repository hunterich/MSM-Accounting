import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
  ListResponse,
  InventoryItem, RawInventoryItem,
  ItemCategory, RawItemCategory,
  StockAdjustment, RawStockAdjustment,
  AdjType, AdjStatus,
} from '../types';

export const INV_KEYS = {
    items:       ['invItems'] as const,
    item:        (id: string) => ['invItems', id] as const,
    categories:  ['invItemCategories'] as const,
    adjustments: ['invAdjustments'] as const,
    adjustment:  (id: string) => ['invAdjustments', id] as const,
};

// ── Status / Type maps ────────────────────────────────────────────────────────

const ADJ_TYPE_DOWN: Record<string, AdjType>   = { QUANTITY: 'Quantity', VALUE: 'Value' };
const ADJ_TYPE_UP:   Record<string, string>    = { Quantity: 'QUANTITY', Value: 'VALUE' };

const ADJ_STATUS_DOWN: Record<string, AdjStatus> = { DRAFT: 'Draft', APPROVED: 'Approved' };
const ADJ_STATUS_UP:   Record<string, string>    = { Draft: 'DRAFT', Approved: 'APPROVED' };

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeItem(raw: RawInventoryItem): InventoryItem {
    const stock = Number(raw.openingStock ?? raw.stockQty ?? raw.stock ?? 0);
    return {
        id:                       raw.id,
        sku:                      raw.sku      || '',
        code:                     raw.sku      || raw.id,
        name:                     raw.name     || '',
        type:                     raw.type     || '',
        categoryId:               raw.categoryId || null,
        category:                 raw.category?.name || '',
        categoryCode:             raw.category?.code || '',
        stock,
        cost:  Number(raw.cost  ?? raw.costPrice  ?? 0),
        price: Number(raw.price ?? raw.sellingPrice ?? 0),
        unit:  raw.unit || 'PCS',
        purchaseUnit:             raw.purchaseUnit || '',
        purchaseConversionFactor: raw.purchaseConversionFactor != null ? Number(raw.purchaseConversionFactor) : null,
        sellUnit:                 raw.sellUnit || '',
        sellConversionFactor:     raw.sellConversionFactor != null ? Number(raw.sellConversionFactor) : null,
        notes:       raw.notes || '',
        description: raw.description || '',
        barcode:     raw.barcode || '',
        weight:      raw.weight != null ? Number(raw.weight) : '',
        openingStock: stock,
        reorderPoint: Number(raw.reorderPoint ?? 0),
        inventoryAccountId: raw.inventoryAccountId || '',
        revenueAccountId:   raw.revenueAccountId   || '',
        cogsAccountId:      raw.cogsAccountId      || '',
        status: stock === 0 ? 'Out of Stock' : stock < 5 ? 'Low Stock' : 'In Stock',
    };
}

function normalizeItemCategory(raw: RawItemCategory): ItemCategory {
    return {
        id:          raw.id,
        name:        raw.name        || '',
        code:        raw.code        || '',
        description: raw.description || '',
        isActive:    raw.isActive !== false,
        skuSequence: raw.skuSequence ?? 0,
    };
}

function normalizeAdjustment(raw: RawStockAdjustment): StockAdjustment {
    return {
        id:     raw.number || raw.id,
        _id:    raw.id,
        number: raw.number || '',
        date:   raw.date ? String(raw.date).slice(0, 10) : '',
        type:   ADJ_TYPE_DOWN[raw.type ?? ''] ?? (raw.type as AdjType),
        reason: raw.reason || '',
        notes:  raw.notes  || '',
        status: ADJ_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as AdjStatus),
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

export function useItems(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...INV_KEYS.items, filters],
        queryFn:  () => api.get<ListResponse<RawInventoryItem>>('/api/v1/items', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeItem),
        }),
        staleTime: 30_000,
    });
}

export function useItem(id: string | undefined) {
    return useQuery({
        queryKey: INV_KEYS.item(id ?? ''),
        queryFn:  () => api.get<RawInventoryItem>(`/api/v1/items/${id}`),
        select:   normalizeItem,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: unknown) => api.post('/api/v1/items', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.items }),
    });
}

export function useUpdateItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<InventoryItem> & { id: string }) =>
            api.put(`/api/v1/items/${id}`, updates),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: INV_KEYS.items });
            qc.invalidateQueries({ queryKey: INV_KEYS.item(vars.id) });
        },
    });
}

export function useDeleteItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/items/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.items }),
    });
}

// ── Item Categories ───────────────────────────────────────────────────────────

export function useItemCategories() {
    return useQuery({
        queryKey: INV_KEYS.categories,
        queryFn:  () => api.get<ListResponse<RawItemCategory>>('/api/v1/item-categories', { limit: 200 }),
        select:   (res) => (res.data || []).map(normalizeItemCategory),
        staleTime: 60_000,
    });
}

export function useCreateItemCategory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<ItemCategory>) => api.post('/api/v1/item-categories', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.categories }),
    });
}

export function useUpdateItemCategory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<ItemCategory> & { id: string }) =>
            api.put(`/api/v1/item-categories/${id}`, updates),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.categories }),
    });
}

export function useDeleteItemCategory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/item-categories/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: INV_KEYS.categories });
            qc.invalidateQueries({ queryKey: INV_KEYS.items });
        },
    });
}

export function useNextItemSku() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (categoryId: string) =>
            api.post<{ sku: string }>(`/api/v1/item-categories/${categoryId}/next-sku`, {}),
        onSuccess: () => qc.invalidateQueries({ queryKey: INV_KEYS.categories }),
    });
}

// ── Stock Adjustments ─────────────────────────────────────────────────────────

export function useStockAdjustments(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...INV_KEYS.adjustments, filters],
        queryFn:  () => api.get<ListResponse<RawStockAdjustment>>('/api/v1/stock-adjustments', filters),
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
        mutationFn: (body: Partial<StockAdjustment>) => api.post('/api/v1/stock-adjustments', {
            ...body,
            type:   ADJ_TYPE_UP[body.type   ?? ''] ?? body.type   ?? 'QUANTITY',
            status: ADJ_STATUS_UP[body.status ?? ''] ?? body.status ?? 'DRAFT',
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: INV_KEYS.adjustments });
            qc.invalidateQueries({ queryKey: INV_KEYS.items });
        },
    });
}

export function useUpdateStockAdjustment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<StockAdjustment> & { id: string }) =>
            api.put(`/api/v1/stock-adjustments/${id}`, {
                ...updates,
                ...(updates.type   && { type:   ADJ_TYPE_UP[updates.type]     ?? updates.type }),
                ...(updates.status && { status: ADJ_STATUS_UP[updates.status] ?? updates.status }),
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: INV_KEYS.adjustments });
            qc.invalidateQueries({ queryKey: INV_KEYS.items });
        },
    });
}
