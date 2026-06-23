import React from 'react';
import { CheckSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import { useApprovals } from '../../../hooks/useAR';
import { formatIDR } from '../../../utils/formatters';

interface ApprovalDocument {
    id: string;
    number?: string;
    amount?: number | null;
}

interface ApprovalItem {
    id: string;
    documentType: string;
    document?: ApprovalDocument;
}

// Human-readable label per document type (mirrors ApprovalInbox).
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
    INVOICE: 'Invoice',
    PURCHASE_ORDER: 'PO',
    BILL: 'Bill',
    SALES_ORDER: 'SO',
    PAYROLL_RUN: 'Payroll',
    CREDIT_NOTE: 'Credit Note',
    DEBIT_NOTE: 'Debit Note',
    SALES_RETURN: 'Sales Return',
    PURCHASE_RETURN: 'Purchase Return',
};

function labelFor(documentType: string): string {
    return DOCUMENT_TYPE_LABELS[documentType] ?? documentType;
}

const PendingApprovalsWidget = (): React.ReactElement => {
    const navigate = useNavigate();
    const { data, isLoading } = useApprovals();
    // API returns { data: ApprovalItem[], total: number } directly (ok() wraps the object as-is)
    const items: ApprovalItem[] = (data as { data?: ApprovalItem[] })?.data ?? [];

    return (
        <Card
            title={
                <div className="flex justify-between items-center">
                    <span className="text-sm text-neutral-500 font-normal">Pending Approvals</span>
                    <CheckSquare size={24} className="text-primary-500" />
                </div>
            }
            padding
        >
            <div className="text-[2rem] font-bold my-2.5">{isLoading ? '—' : items.length}</div>
            <ul className="text-sm divide-y divide-neutral-100">
                {items.slice(0, 5).map((r) => (
                    <li key={r.id} className="py-1.5 flex justify-between gap-2">
                        <span className="truncate">
                            {labelFor(r.documentType)}{r.document?.number ? ` ${r.document.number}` : ''}
                        </span>
                        <span className="text-neutral-500 shrink-0">
                            {r.document?.amount != null ? formatIDR(Number(r.document.amount)) : '—'}
                        </span>
                    </li>
                ))}
                {!isLoading && items.length === 0 && (
                    <li className="py-1.5 text-neutral-400">Nothing waiting</li>
                )}
            </ul>
            <button
                onClick={() => navigate('/ar/approvals')}
                className="mt-2 text-sm text-primary-600 hover:underline"
            >
                Open Approval Inbox →
            </button>
        </Card>
    );
};

export default PendingApprovalsWidget;
