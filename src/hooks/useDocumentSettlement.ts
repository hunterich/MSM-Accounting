import { useQuery } from '@tanstack/react-query';
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
