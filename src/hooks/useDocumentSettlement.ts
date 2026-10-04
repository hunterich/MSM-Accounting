import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../api/apiClient';

export type SettlementKind = 'invoice' | 'bill';
export type SettlementState = 'DRAFT' | 'VOID' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'OUTSTANDING';

export interface SettlementEntry {
    id: string;
    number: string;
    date: string;
    amount: number;
    kind: 'payment' | 'return';
}

export interface DocumentSettlement {
    total: number;
    paid: number;
    returned: number;
    owing: number;
    state: SettlementState;
    entries: SettlementEntry[];
}

const PATHS: Record<SettlementKind, (id: string) => string> = {
    invoice: (id) => `/api/v1/invoices/${encodeURIComponent(id)}/settlement`,
    bill:    (id) => `/api/v1/bills/${encodeURIComponent(id)}/settlement`,
};

/** Paid / returned / owing position of one sales invoice or purchase bill. */
export function useDocumentSettlement(kind: SettlementKind, id: string | undefined) {
    return useQuery({
        queryKey: ['documentSettlement', kind, id],
        queryFn: () => api.get<DocumentSettlement>(PATHS[kind](id as string)),
        enabled: !!id,
    });
}

/** Payment forms must apply the remaining balance, not the document's original total. */
export function useOutstandingDocuments<T extends { id: string; _id?: string; amount: number }>(
    kind: SettlementKind, documents: T[], enabled: boolean,
) {
    const combine = useCallback((queries: UseQueryResult<DocumentSettlement>[]) => ({
        documents: enabled ? documents.flatMap((document, i) => {
            const settlement = queries[i]?.data;
            return settlement && settlement.owing > 0 && !['DRAFT', 'VOID'].includes(settlement.state)
                ? [{ ...document, amount: settlement.owing }] : [];
        }) : documents,
        isLoading: queries.some(q => q.isPending || q.isFetching),
        isError: queries.some(q => q.isError),
    }), [enabled, documents]);
    return useQueries({ queries: enabled ? documents.map(document => ({
        queryKey: ['documentSettlement', kind, document._id || document.id],
        queryFn: () => api.get<DocumentSettlement>(PATHS[kind](document._id || document.id)),
        refetchOnMount: 'always' as const,
    })) : [], combine });
}
