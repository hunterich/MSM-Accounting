import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { ListResponse } from '../types';

/**
 * React Query hooks for the POS sales-type engine (tipe penjualan, back-office
 * admin). Mirrors the api-client + queryKey + invalidation conventions used in
 * useModifiers.ts. Endpoints are gated server-side by the POS_RETAIL permission;
 * tenant context is derived from the session cookie.
 */

export type SalesChannel = 'OFFLINE' | 'ONLINE';

export interface SalesType {
    id: string;
    organizationId: string;
    name: string;
    channel: SalesChannel;
    serviceChargePct: number;
    chargeAccountId: string | null;
    taxable: boolean;
    sortOrder: number;
    isActive: boolean;
}

/** Payload sent to POST/PUT. */
export interface SalesTypeInput {
    name: string;
    channel: SalesChannel;
    serviceChargePct: number;
    chargeAccountId: string | null;
    taxable: boolean;
    sortOrder: number;
    isActive: boolean;
}

// ── Raw API shapes ─────────────────────────────────────────────────────────────

interface RawSalesType {
    id: string;
    organizationId: string;
    name: string;
    channel: SalesChannel;
    serviceChargePct: number | string;
    chargeAccountId: string | null;
    taxable: boolean;
    sortOrder: number;
    isActive: boolean;
}

// ── Sales-by-Type report shapes ─────────────────────────────────────────────────

export interface SalesByTypeRow {
    id: string | null;
    name: string;
    channel: SalesChannel | null;
    count: number;
    gross: number;
    netPreTax: number;
}

export interface SalesByTypeResponse {
    data: SalesByTypeRow[];
    from: string;
    to: string;
}

export const SALES_TYPE_KEYS = {
    list:   ['salesTypes'] as const,
    report: (from?: string, to?: string) => ['salesByType', from ?? 'all', to ?? 'all'] as const,
};

// ── Normalizers ─────────────────────────────────────────────────────────────────

function normalizeSalesType(raw: RawSalesType): SalesType {
    return {
        id:               raw.id,
        organizationId:   raw.organizationId,
        name:             raw.name || '',
        channel:          raw.channel === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
        serviceChargePct: Number(raw.serviceChargePct ?? 0),
        chargeAccountId:  raw.chargeAccountId ?? null,
        taxable:          raw.taxable === true,
        sortOrder:        Number(raw.sortOrder ?? 0),
        isActive:         raw.isActive !== false,
    };
}

// ── Sales Types (CRUD) ───────────────────────────────────────────────────────────

export function useSalesTypes() {
    return useQuery({
        queryKey: SALES_TYPE_KEYS.list,
        queryFn:  () => api.get<ListResponse<RawSalesType>>('/api/v1/sales-types', { limit: 100 }),
        select:   (res) => (res.data || []).map(normalizeSalesType),
        staleTime: 30_000,
    });
}

export function useCreateSalesType() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: SalesTypeInput) => api.post('/api/v1/sales-types', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: SALES_TYPE_KEYS.list }),
    });
}

export function useUpdateSalesType() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...body }: SalesTypeInput & { id: string }) =>
            api.put(`/api/v1/sales-types/${id}`, body),
        onSuccess: () => qc.invalidateQueries({ queryKey: SALES_TYPE_KEYS.list }),
    });
}

export function useDeleteSalesType() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/sales-types/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: SALES_TYPE_KEYS.list }),
    });
}

// ── Sales-by-Type report ─────────────────────────────────────────────────────────

export function useSalesByType(from?: string, to?: string) {
    return useQuery({
        queryKey: SALES_TYPE_KEYS.report(from, to),
        queryFn:  () => api.get<SalesByTypeResponse>('/api/v1/reports/sales/by-type', { from, to }),
        staleTime: 30_000,
    });
}
