import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { accountingPeriodKeys } from './useAccountingPeriods';

/**
 * React Query hooks for the fiscal-year close.
 *
 * The preview is the interesting one: it is what the confirm screen renders
 * AND what the close route re-checks server-side, so the button can never
 * offer a close the API would refuse.
 */

export interface ClosingLine {
    accountId: string;
    code: string;
    name: string;
    type: 'REVENUE' | 'EXPENSE';
    balance: number;
}

export interface ClosingPreview {
    range: { startDate: string; endDate: string; label: string };
    openMonths: string[];
    lines: ClosingLine[];
    totalRevenue: number;
    totalExpense: number;
    netIncome: number;
    retainedEarningsAccountId: string | null;
    retainedEarningsAccountName: string | null;
    closedEntryNo: string | null;
    canClose: boolean;
    blockedReason: string | null;
}

export const fiscalYearKeys = {
    preview: ['fiscal-year', 'close-preview'] as const,
};

export function useFiscalYearPreview(enabled = true) {
    return useQuery({
        queryKey: fiscalYearKeys.preview,
        queryFn: () => api.get<ClosingPreview>('/api/v1/fiscal-year/close-preview'),
        enabled,
    });
}

/** Both mutations invalidate the period list too — closing a year writes a
 *  journal entry, and reopening deletes one. */
function useFiscalYearMutation(path: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.post<Record<string, unknown>>(path),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: fiscalYearKeys.preview });
            void qc.invalidateQueries({ queryKey: accountingPeriodKeys.all });
        },
    });
}

export const useCloseFiscalYear = () => useFiscalYearMutation('/api/v1/fiscal-year/close');
export const useReopenFiscalYear = () => useFiscalYearMutation('/api/v1/fiscal-year/reopen');
