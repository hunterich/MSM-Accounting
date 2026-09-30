import React from 'react';
import { useDocumentSettlement, type SettlementKind, type SettlementState } from '../../hooks/useDocumentSettlement';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { formatDateID, formatIDR } from '../../utils/formatters';

interface Props {
    kind: SettlementKind;
    /** Invoice / bill id (bills also accept the bill number). */
    id: string | undefined;
}

const STATE_UI: Record<SettlementState, { label: string; pill: string; stamp: string }> = {
    PAID:        { label: 'Paid',        pill: 'bg-success-50 text-success-700 border-success-200', stamp: 'text-success-600 border-success-600' },
    PARTIAL:     { label: 'Partial',     pill: 'bg-warning-50 text-warning-800 border-warning-200', stamp: 'text-warning-600 border-warning-600' },
    OUTSTANDING: { label: 'Outstanding', pill: 'bg-warning-50 text-warning-800 border-warning-200', stamp: 'text-warning-600 border-warning-600' },
    OVERDUE:     { label: 'Overdue',     pill: 'bg-danger-50 text-danger-700 border-danger-200',    stamp: 'text-danger-600 border-danger-600' },
    VOID:        { label: 'Void',        pill: 'bg-neutral-100 text-neutral-700 border-neutral-300', stamp: 'text-neutral-500 border-neutral-500' },
    DRAFT:       { label: 'Draft',       pill: 'bg-neutral-100 text-neutral-700 border-neutral-300', stamp: 'text-neutral-500 border-neutral-500' },
};

/**
 * Accurate-style "Invoice Information" block: what was billed, what has been
 * paid / returned, what is still owing, plus the payment history and a status
 * stamp. Shared by sales invoices and purchase bills.
 */
const DocumentSettlementPanel: React.FC<Props> = ({ kind, id }) => {
    const { data, isLoading, isError } = useDocumentSettlement(kind, id);
    const { open } = useWorkspaceNav();

    if (isLoading) return <div className="text-[13px] text-neutral-500 py-3">Loading payment status…</div>;
    if (isError || !data) return null;

    const ui = STATE_UI[data.state];
    const paymentLabel = kind === 'invoice' ? 'Receipts' : 'Payments';
    const returnLabel = kind === 'invoice' ? 'Returns & credits' : 'Returns & debits';
    const moduleName = kind === 'invoice' ? 'ar' : 'ap';

    const openPayment = (paymentId: string, number: string) => open({
        kind: 'doc-view',
        target: { module: moduleName, entity: 'payment', recordId: paymentId, mode: 'view' },
        title: number,
        path: `/${moduleName}/payments?paymentId=${paymentId}`,
    });

    const rows: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [
        { label: 'Total', value: formatIDR(data.total) },
        { label: paymentLabel, value: formatIDR(data.paid), muted: data.paid === 0 },
        { label: returnLabel, value: formatIDR(data.returned), muted: data.returned === 0 },
        { label: 'Owing', value: formatIDR(data.owing), strong: true },
    ];

    return (
        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6 bg-neutral-0 border border-neutral-200 rounded-lg p-4 overflow-hidden">
            <div>
                <div className="text-[15px] font-semibold text-primary-700 mb-2">Payment status</div>
                <div className="border border-neutral-200 rounded-md divide-y divide-neutral-200 text-[13px] tabular-nums">
                    {rows.map((r) => (
                        <div key={r.label} className="flex items-center justify-between px-3 py-2">
                            <span className="text-neutral-700">{r.label}</span>
                            <span className={r.strong ? 'font-bold text-neutral-900' : r.muted ? 'text-neutral-400' : 'text-neutral-900'}>{r.value}</span>
                        </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-neutral-700">Status</span>
                        <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${ui.pill}`}>{ui.label}</span>
                    </div>
                </div>
            </div>

            <div>
                <div className="text-[15px] font-semibold text-primary-700 mb-2">Payment history</div>
                {data.entries.length === 0 ? (
                    <div className="border border-dashed border-neutral-300 rounded-md px-3 py-4 text-[13px] text-neutral-500">
                        Nothing applied yet.
                    </div>
                ) : (
                    <ul className="border border-neutral-200 rounded-md divide-y divide-neutral-200 text-[13px] tabular-nums">
                        {data.entries.map((e) => (
                            <li key={`${e.kind}-${e.id}`} className="flex items-start justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                    {e.kind === 'payment' ? (
                                        <button type="button" onClick={() => openPayment(e.id, e.number)}
                                            className="font-mono text-primary-700 hover:underline break-all text-left">
                                            {e.number}
                                        </button>
                                    ) : (
                                        <span className="font-mono break-all">{e.number}</span>
                                    )}
                                    <div className="text-[11px] text-neutral-500">
                                        {formatDateID(e.date)}{e.kind === 'return' ? ' · return' : ''}
                                    </div>
                                </div>
                                <span className="font-medium whitespace-nowrap">{formatIDR(e.amount)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {data.state !== 'DRAFT' && (
                <div
                    aria-hidden
                    className={`pointer-events-none select-none absolute right-6 bottom-4 -rotate-12 rounded-md border-[3px] px-4 py-1 text-2xl font-black uppercase tracking-[0.2em] opacity-20 print:opacity-30 ${ui.stamp}`}
                >
                    {ui.label}
                </div>
            )}
        </div>
    );
};

export default DocumentSettlementPanel;
