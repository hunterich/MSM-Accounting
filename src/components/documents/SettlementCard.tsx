import React from 'react';
import { formatIDR } from '../../utils/formatters';

/**
 * SettlementCard — the "Informasi Faktur" panel for a POSTED invoice/bill.
 * Only render this once the document is posted (a draft has no settlement yet).
 *
 * Payment received & Returns are click-through links to the underlying records.
 * Mirrors Accurate: Total → Down payment → Payment → Returns → Outstanding → Status.
 */

export interface PaymentRecord {
    id: string;
    date: string;
    method?: string;
    amount: number;
}

interface SettlementCardProps {
    total: number;
    advance?: number;
    paid?: number;
    returns?: number;
    payments?: PaymentRecord[];
    onOpenPayment?: (id: string) => void;
    onOpenReturns?: () => void;
    /** hide rows that are still zero (down payment / returns) to reduce clutter */
    hideZeroRows?: boolean;
}

const tone = (status: string) =>
    status === 'Paid' ? { bg: 'bg-success-50', fg: 'text-success-700', border: 'border-success-200', dot: 'bg-success-500' } :
    status === 'Partial' ? { bg: 'bg-warning-50', fg: 'text-warning-800', border: 'border-warning-200', dot: 'bg-warning-500' } :
    { bg: 'bg-danger-50', fg: 'text-danger-700', border: 'border-danger-200', dot: 'bg-danger-500' };

const Row = ({ k, v, link, onClick }: { k: string; v: number; link?: boolean; onClick?: () => void }) => (
    <div className="flex justify-between items-center py-2 border-b border-neutral-100">
        <span className="text-neutral-600">{k}</span>
        {link && v > 0 ? (
            <button onClick={onClick} className="inline-flex items-center gap-0.5 tabular-nums font-medium text-primary-700 hover:underline">
                {formatIDR(v)}<span className="text-[13px] leading-none">›</span>
            </button>
        ) : (
            <span className="tabular-nums text-neutral-900">{formatIDR(v)}</span>
        )}
    </div>
);

const SettlementCard = ({
    total, advance = 0, paid = 0, returns = 0, payments = [],
    onOpenPayment, onOpenReturns, hideZeroRows = false,
}: SettlementCardProps): React.ReactElement => {
    const outstanding = total - advance - paid - returns;
    const status = outstanding <= 0 ? 'Paid' : paid > 0 || advance > 0 ? 'Partial' : 'Unpaid';
    const t = tone(status);

    return (
        <div className="flex flex-col gap-4">
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-1">Invoice information</div>
                <Row k="Total" v={total} />
                {(!hideZeroRows || advance > 0) && <Row k="Down payment (uang muka)" v={advance} />}
                <Row k="Payment received" v={paid} link onClick={() => payments[0] && onOpenPayment?.(payments[0].id)} />
                {(!hideZeroRows || returns > 0) && <Row k="Returns" v={returns} link onClick={onOpenReturns} />}
                <div className="flex justify-between items-center py-2 mt-1 px-2 -mx-2 rounded-md bg-neutral-50">
                    <span className="font-semibold text-neutral-900">Outstanding (piutang)</span>
                    <span className={`tabular-nums font-bold ${outstanding > 0 ? 'text-danger-600' : 'text-success-600'}`}>{formatIDR(outstanding)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                    <span className="font-semibold text-neutral-900">Status</span>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${t.bg} ${t.fg} ${t.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />{status}
                    </span>
                </div>
            </div>

            {payments.length > 0 && (
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">Payment history</div>
                    <div className="flex flex-col gap-2 text-[12px]">
                        {payments.map((p) => (
                            <div key={p.id} className="flex items-center justify-between">
                                <div>
                                    <button onClick={() => onOpenPayment?.(p.id)} className="font-mono text-[12px] text-primary-700 hover:underline">{p.id}</button>
                                    <div className="text-[11px] text-neutral-500">{p.date}{p.method ? ` · ${p.method}` : ''}</div>
                                </div>
                                <span className="tabular-nums text-[13px] font-semibold text-neutral-900">{formatIDR(p.amount)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettlementCard;
