import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Inbox } from 'lucide-react';
import { api } from '../../api/apiClient';
import Button from '../../components/UI/Button';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import { formatDateID, formatIDR } from '../../utils/formatters';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocumentType = 'INVOICE' | 'PURCHASE_ORDER';
type FilterType = 'ALL' | 'INVOICE' | 'PURCHASE_ORDER';

interface ApprovalRequest {
    id: string;
    documentType: DocumentType;
    documentId: string;
    requestedAt: string;
    requestedBy: { id: string; fullName: string };
    document: {
        id: string;
        number: string;
        totalAmount: number;
        customer?: { name: string };
        vendor?: { name: string };
    };
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error';
}

let toastSeq = 0;

// ── Component ─────────────────────────────────────────────────────────────────

const ApprovalInbox: React.FC = () => {
    const queryClient = useQueryClient();

    const [toasts, setToasts] = useState<Toast[]>([]);
    const pushToast = (message: string, type: 'success' | 'error' = 'success') => {
        const id = ++toastSeq;
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    };

    const [filterType, setFilterType] = useState<FilterType>('ALL');

    // Tracks which rows have the reject form open and the note being typed
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectNote, setRejectNote] = useState('');

    // ── Queries ───────────────────────────────────────────────────────────────

    const { data: listData, isLoading } = useQuery<{ data: ApprovalRequest[] }>({
        queryKey: ['approvals'],
        queryFn: () => api.get('/api/v1/approvals'),
    });

    const approvals = listData?.data ?? [];

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['approvals'] });

    // ── Mutations ─────────────────────────────────────────────────────────────

    const approveMutation = useMutation({
        mutationFn: (req: ApprovalRequest) => {
            const baseUrl =
                req.documentType === 'INVOICE'
                    ? `/api/v1/invoices/${req.documentId}`
                    : `/api/v1/purchase-orders/${req.documentId}`;
            return api.post(`${baseUrl}/approve`);
        },
        onSuccess: (_data, req) => {
            invalidate();
            pushToast(`${req.document.number} approved.`);
        },
        onError: (err: Error) => pushToast(err.message, 'error'),
    });

    const rejectMutation = useMutation({
        mutationFn: ({ req, note }: { req: ApprovalRequest; note: string }) => {
            const baseUrl =
                req.documentType === 'INVOICE'
                    ? `/api/v1/invoices/${req.documentId}`
                    : `/api/v1/purchase-orders/${req.documentId}`;
            return api.post(`${baseUrl}/reject`, { note });
        },
        onSuccess: (_data, vars) => {
            invalidate();
            setRejectingId(null);
            setRejectNote('');
            pushToast(`${vars.req.document.number} rejected.`);
        },
        onError: (err: Error) => pushToast(err.message, 'error'),
    });

    // ── Helpers ───────────────────────────────────────────────────────────────

    const openRejectForm = (id: string) => {
        setRejectingId(id);
        setRejectNote('');
    };

    const cancelReject = () => {
        setRejectingId(null);
        setRejectNote('');
    };

    const submitReject = (req: ApprovalRequest) => {
        rejectMutation.mutate({ req, note: rejectNote });
    };

    // ── Filtered data ─────────────────────────────────────────────────────────

    const filtered = approvals.filter((a) => {
        if (filterType === 'ALL') return true;
        return a.documentType === filterType;
    });

    // ── Table columns ─────────────────────────────────────────────────────────

    const columns: TableColumn<Record<string, unknown>>[] = [
        {
            key: 'documentType',
            label: 'Doc Type',
            render: (val) => {
                const label = val === 'INVOICE' ? 'Invoice' : 'Purchase Order';
                const status = val === 'INVOICE' ? 'info' : 'warning';
                return <StatusTag status={status} label={label} />;
            },
        },
        {
            key: 'document',
            label: 'Number',
            render: (_val, row) => {
                const doc = row['document'] as ApprovalRequest['document'] | undefined;
                return <span className="font-medium text-neutral-900">{doc?.number ?? '—'}</span>;
            },
        },
        {
            key: 'party',
            label: 'Party',
            render: (_val, row) => {
                const req = row as unknown as ApprovalRequest;
                const name =
                    req.documentType === 'INVOICE'
                        ? req.document.customer?.name
                        : req.document.vendor?.name;
                return <span>{name ?? '—'}</span>;
            },
        },
        {
            key: 'amount',
            label: 'Amount',
            align: 'right',
            render: (_val, row) => {
                const doc = row['document'] as ApprovalRequest['document'] | undefined;
                return formatIDR(doc?.totalAmount ?? 0);
            },
        },
        {
            key: 'requestedBy',
            label: 'Requested By',
            render: (_val, row) => {
                const by = row['requestedBy'] as ApprovalRequest['requestedBy'] | undefined;
                return <span>{by?.fullName ?? '—'}</span>;
            },
        },
        {
            key: 'requestedAt',
            label: 'Requested At',
            sortable: true,
            render: (val) => formatDateID(val as string),
        },
        {
            key: 'actions',
            label: '',
            render: (_val, row) => {
                const req = row as unknown as ApprovalRequest;

                if (rejectingId === req.id) {
                    return (
                        <div className="flex items-center gap-2 py-1">
                            <input
                                type="text"
                                autoFocus
                                className="h-8 px-2 rounded border border-neutral-300 text-sm focus:border-primary-500 focus:outline-0 w-48"
                                placeholder="Reason for rejection…"
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') submitReject(req);
                                    if (e.key === 'Escape') cancelReject();
                                }}
                            />
                            <Button
                                size="small"
                                variant="danger"
                                text={rejectMutation.isPending ? '…' : 'Confirm'}
                                onClick={() => submitReject(req)}
                                disabled={rejectMutation.isPending}
                            />
                            <Button
                                size="small"
                                variant="secondary"
                                text="Cancel"
                                onClick={cancelReject}
                                disabled={rejectMutation.isPending}
                            />
                        </div>
                    );
                }

                return (
                    <div className="flex items-center gap-1 justify-end">
                        <Button
                            size="small"
                            variant="secondary"
                            icon={<CheckCircle size={13} />}
                            text="Approve"
                            onClick={(e) => {
                                e.stopPropagation();
                                approveMutation.mutate(req);
                            }}
                            disabled={approveMutation.isPending}
                        />
                        <Button
                            size="small"
                            variant="danger"
                            icon={<XCircle size={13} />}
                            text="Reject"
                            onClick={(e) => {
                                e.stopPropagation();
                                openRejectForm(req.id);
                            }}
                        />
                    </div>
                );
            },
        },
    ];

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="container ar-module container-full-width">
            {/* Toast notifications */}
            <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-neutral-0 transition-all ${
                            t.type === 'error' ? 'bg-danger-500' : 'bg-success-500'
                        }`}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* Page header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900">Approval Inbox</h1>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        Review and action pending document approvals.
                    </p>
                </div>
                {/* Badge showing pending count */}
                {filtered.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning-100 text-warning-600 text-sm font-medium">
                        <Inbox size={14} />
                        {filtered.length} pending
                    </span>
                )}
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 mb-4 border-b border-neutral-200">
                {(['ALL', 'INVOICE', 'PURCHASE_ORDER'] as FilterType[]).map((type) => {
                    const label =
                        type === 'ALL' ? 'All' : type === 'INVOICE' ? 'Invoices' : 'Purchase Orders';
                    const count =
                        type === 'ALL'
                            ? approvals.length
                            : approvals.filter((a) => a.documentType === type).length;
                    return (
                        <button
                            key={type}
                            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                filterType === type
                                    ? 'border-primary-700 text-primary-700'
                                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                            }`}
                            onClick={() => setFilterType(type)}
                        >
                            {label}
                            {count > 0 && (
                                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-neutral-200 text-neutral-600 text-xs">
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Table or empty state */}
            {!isLoading && filtered.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Inbox size={40} className="text-neutral-300 mb-3" />
                        <p className="text-base font-medium text-neutral-700">No pending approvals</p>
                        <p className="text-sm text-neutral-400 mt-1">
                            Everything is up to date. Check back later.
                        </p>
                    </div>
                </Card>
            ) : (
                <Card padding={false}>
                    <Table
                        columns={columns}
                        data={filtered as unknown as Record<string, unknown>[]}
                        isLoading={isLoading}
                        loadingLabel="Loading approvals..."
                        showCount
                        countLabel="pending approvals"
                        virtualize={false}
                    />
                </Card>
            )}
        </div>
    );
};

export default ApprovalInbox;
