import React from 'react';
import { CheckSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import { useApprovals } from '../../../hooks/useAR';
import { formatIDR } from '../../../utils/formatters';

interface ApprovalDocument {
    id: string;
    number?: string;
    totalAmount?: number;
}

interface ApprovalItem {
    id: string;
    documentType: string;
    document?: ApprovalDocument;
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
                            {r.documentType === 'INVOICE' ? 'Invoice' : 'PO'}{r.document?.number ? ` ${r.document.number}` : ''}
                        </span>
                        <span className="text-neutral-500 shrink-0">
                            {formatIDR(Number(r.document?.totalAmount ?? 0))}
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
