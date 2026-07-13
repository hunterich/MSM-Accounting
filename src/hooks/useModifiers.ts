import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { ListResponse } from '../types';

/**
 * React Query hooks for the POS modifier engine (back-office admin).
 * Mirrors the api-client + queryKey + invalidation conventions used in
 * useInventory.ts. Endpoints are gated server-side by the POS_RETAIL
 * permission; tenant context is derived from the session cookie.
 */

export type SelectionType = 'SINGLE' | 'MULTI';

export interface ModifierOption {
    id?: string;
    name: string;
    priceDelta: number;
    itemId: string | null;
    sortOrder: number;
    isActive: boolean;
}

export interface ModifierGroup {
    id: string;
    name: string;
    selectionType: SelectionType;
    isRequired: boolean;
    sortOrder: number;
    isActive: boolean;
    options: ModifierOption[];
    attachmentCount: number;
}

export interface ModifierAttachment {
    id: string;
    groupId: string;
    itemId: string | null;
    itemCategoryId: string | null;
    group?: { id: string; name: string };
    item?: { id: string; name: string } | null;
    itemCategory?: { id: string; name: string } | null;
}

/** Payload sent to POST/PUT — options replace the group's full option set. */
export interface ModifierGroupInput {
    name: string;
    selectionType: SelectionType;
    isRequired: boolean;
    sortOrder: number;
    isActive: boolean;
    options: Array<{
        name: string;
        priceDelta: number;
        itemId: string | null;
        sortOrder: number;
        isActive: boolean;
    }>;
}

// ── Raw API shapes ─────────────────────────────────────────────────────────────

interface RawModifierOption {
    id: string;
    name: string;
    priceDelta: number | string;
    itemId: string | null;
    sortOrder: number;
    isActive: boolean;
}

interface RawModifierGroup {
    id: string;
    name: string;
    selectionType: SelectionType;
    isRequired: boolean;
    sortOrder: number;
    isActive: boolean;
    options?: RawModifierOption[];
    _count?: { attachments: number };
}

export const MODIFIER_KEYS = {
    groups:      ['modifierGroups'] as const,
    attachments: (groupId?: string) => ['modifierAttachments', groupId ?? 'all'] as const,
};

// ── Normalizers ─────────────────────────────────────────────────────────────────

function normalizeGroup(raw: RawModifierGroup): ModifierGroup {
    return {
        id:            raw.id,
        name:          raw.name || '',
        selectionType: raw.selectionType === 'MULTI' ? 'MULTI' : 'SINGLE',
        isRequired:    raw.isRequired === true,
        sortOrder:     Number(raw.sortOrder ?? 0),
        isActive:      raw.isActive !== false,
        options:       (raw.options || []).map((o) => ({
            id:        o.id,
            name:      o.name || '',
            priceDelta: Number(o.priceDelta ?? 0),
            itemId:    o.itemId ?? null,
            sortOrder: Number(o.sortOrder ?? 0),
            isActive:  o.isActive !== false,
        })),
        attachmentCount: raw._count?.attachments ?? 0,
    };
}

// ── Modifier Groups ──────────────────────────────────────────────────────────────

export function useModifierGroups() {
    return useQuery({
        queryKey: MODIFIER_KEYS.groups,
        queryFn:  () => api.get<ListResponse<RawModifierGroup>>('/api/v1/modifier-groups', { limit: 100 }),
        select:   (res) => (res.data || []).map(normalizeGroup),
        staleTime: 30_000,
    });
}

export function useCreateModifierGroup() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: ModifierGroupInput) => api.post('/api/v1/modifier-groups', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: MODIFIER_KEYS.groups }),
    });
}

export function useUpdateModifierGroup() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...body }: ModifierGroupInput & { id: string }) =>
            api.put(`/api/v1/modifier-groups/${id}`, body),
        onSuccess: () => qc.invalidateQueries({ queryKey: MODIFIER_KEYS.groups }),
    });
}

export function useDeleteModifierGroup() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/modifier-groups/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: MODIFIER_KEYS.groups });
            qc.invalidateQueries({ queryKey: ['modifierAttachments'] });
        },
    });
}

// ── Modifier Attachments ─────────────────────────────────────────────────────────

export function useModifierAttachments(groupId?: string) {
    return useQuery({
        queryKey: MODIFIER_KEYS.attachments(groupId),
        queryFn:  () => api.get<ModifierAttachment[]>('/api/v1/modifier-attachments', { groupId }),
        enabled:  Boolean(groupId),
        staleTime: 30_000,
    });
}

export function useCreateModifierAttachment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: { groupId: string; itemId?: string; itemCategoryId?: string }) =>
            api.post('/api/v1/modifier-attachments', body),
        onSuccess: (_res, vars) => {
            qc.invalidateQueries({ queryKey: MODIFIER_KEYS.attachments(vars.groupId) });
            qc.invalidateQueries({ queryKey: MODIFIER_KEYS.groups });
        },
    });
}

export function useDeleteModifierAttachment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/modifier-attachments/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['modifierAttachments'] });
            qc.invalidateQueries({ queryKey: MODIFIER_KEYS.groups });
        },
    });
}
