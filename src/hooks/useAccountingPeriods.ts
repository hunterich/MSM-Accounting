import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { ListResponse } from '../types';

/**
 * React Query hooks for monthly period close.
 *
 * The period list is the real DB state — Company Setup used to render twelve
 * rows derived from `fiscalYearStart` and label any month in the past "Closed",
 * which was a guess the database never agreed with.
 */

export type PeriodStatus = 'OPEN' | 'CLOSED';

export interface AccountingPeriod {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: PeriodStatus;
    isLocked: boolean;
    closedAt: string | null;
    closedByName: string | null;
}

export interface CloseChecklistItem {
    key: string;
    label: string;
    count: number;
    /** A blocking item with a non-zero count makes the close fail server-side. */
    blocking: boolean;
}

export interface CloseChecklist {
    items: CloseChecklistItem[];
    canClose: boolean;
}

interface RawPeriod {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: PeriodStatus;
    isLocked: boolean;
    closedAt?: string | null;
    closedBy?: { id: string; fullName: string } | null;
}

const normalize = (raw: RawPeriod): AccountingPeriod => ({
    id: raw.id,
    name: raw.name,
    startDate: raw.startDate,
    endDate: raw.endDate,
    status: raw.status,
    isLocked: raw.isLocked,
    closedAt: raw.closedAt ?? null,
    closedByName: raw.closedBy?.fullName ?? null,
});

export const accountingPeriodKeys = {
    all: ['accounting-periods'] as const,
    checklist: (id: string) => ['accounting-periods', id, 'close-checklist'] as const,
};

export function useAccountingPeriods(enabled = true) {
    return useQuery({
        queryKey: accountingPeriodKeys.all,
        queryFn: async () => {
            // One fiscal year is twelve rows; the cap keeps a long-lived company
            // from paging on a screen that reads as a single list.
            const res = await api.get<ListResponse<RawPeriod>>('/api/v1/accounting-periods', { limit: 100 });
            return (res.data ?? []).map(normalize);
        },
        enabled,
    });
}

/** Pre-close preview. Only fetched while a period is actually being closed. */
export function useCloseChecklist(periodId: string | null) {
    return useQuery({
        queryKey: accountingPeriodKeys.checklist(periodId ?? 'none'),
        queryFn: () => api.get<CloseChecklist>(`/api/v1/accounting-periods/${periodId}/close-checklist`),
        enabled: Boolean(periodId),
    });
}

export function useClosePeriod() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (periodId: string) => api.post(`/api/v1/accounting-periods/${periodId}/close`),
        onSuccess: () => qc.invalidateQueries({ queryKey: accountingPeriodKeys.all }),
    });
}

export function useReopenPeriod() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (periodId: string) => api.post(`/api/v1/accounting-periods/${periodId}/reopen`),
        onSuccess: () => qc.invalidateQueries({ queryKey: accountingPeriodKeys.all }),
    });
}

/**
 * Backfill the fiscal year's monthly periods. Idempotent server-side, so the
 * button stays safe to press twice.
 */
export function useGeneratePeriods() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.post<{ created: number }>('/api/v1/accounting-periods/generate'),
        onSuccess: () => qc.invalidateQueries({ queryKey: accountingPeriodKeys.all }),
    });
}
