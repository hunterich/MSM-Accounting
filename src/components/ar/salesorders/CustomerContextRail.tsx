import React from 'react';
import { User, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatIDR } from '../../../utils/formatters';
import StatusTag from '../../UI/StatusTag';

/**
 * CustomerContextRail — the sticky right column on the refined Sales Order form.
 *
 * Surfaces the context an operator needs WITHOUT leaving the form:
 *  - credit limit gauge + over-limit warning
 *  - the customer's recent invoices
 *
 * All data is passed in as props so this component stays presentational and
 * testable. The host form is responsible for fetching.
 */

export interface RecentDoc {
    id: string;
    /** status key understood by StatusTag (paid / overdue / partial / sent / draft) */
    status: string;
    /** optional severity suffix, e.g. "12d" for overdue */
    severity?: string;
}

interface CustomerContextRailProps {
    customerName: string;
    taxId?: string;
    /** total credit extended to this customer */
    creditLimit?: number;
    /** currently outstanding (open AR) before this order */
    outstanding?: number;
    /** grand total of the order being edited */
    orderTotal: number;
    recentDocs?: RecentDoc[];
    /** rendered when no customer is selected yet */
    placeholder?: React.ReactNode;
    hasCustomer: boolean;
}

const Money = ({ value }: { value: number }) => (
    <span className="tabular-nums">{formatIDR(value)}</span>
);

const CustomerContextRail = ({
    customerName,
    taxId,
    creditLimit,
    outstanding = 0,
    orderTotal,
    recentDocs = [],
    placeholder,
    hasCustomer,
}: CustomerContextRailProps): React.ReactElement => {
    if (!hasCustomer) {
        return (
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4 text-sm text-neutral-500">
                {placeholder ?? 'Select a customer to see credit limit and history.'}
            </div>
        );
    }

    const hasLimit = typeof creditLimit === 'number' && creditLimit > 0;
    const afterThis = outstanding + orderTotal;
    const overBy = hasLimit ? afterThis - (creditLimit as number) : 0;
    const overLimit = hasLimit && overBy > 0;
    const usedPct = hasLimit ? Math.min(100, (afterThis / (creditLimit as number)) * 100) : 0;

    return (
        <div className="flex flex-col gap-4">
            {/* Identity */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                    <span className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500">
                        <User size={14} />
                    </span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900 leading-tight truncate">{customerName}</div>
                        {taxId && <div className="text-[11px] text-neutral-500 truncate">NPWP {taxId}</div>}
                    </div>
                </div>

                {hasLimit ? (
                    <>
                        <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-1.5">Credit limit</div>
                        <div className="h-2 rounded-full bg-neutral-100 overflow-hidden mb-1.5">
                            <div
                                className={`h-full ${overLimit ? 'bg-danger-500' : 'bg-success-500'}`}
                                style={{ width: `${usedPct}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[12px] mb-2 text-neutral-500">
                            <span>Used <Money value={outstanding} /></span>
                            <span>Limit <Money value={creditLimit as number} /></span>
                        </div>
                        {overLimit ? (
                            <div className="flex items-start gap-2 p-2 rounded-md bg-danger-50 border border-danger-200 text-[12px] text-danger-700">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>This order pushes them <b><Money value={overBy} /></b> over limit. Approval required to confirm.</span>
                            </div>
                        ) : (
                            <div className="flex items-start gap-2 p-2 rounded-md bg-success-50 border border-success-200 text-[12px] text-success-700">
                                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                                <span>Within limit after this order.</span>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-[12px] text-neutral-500">No credit limit set for this customer.</div>
                )}
            </div>

            {/* Recent activity */}
            {recentDocs.length > 0 && (
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">Recent invoices</div>
                    <div className="flex flex-col gap-2 text-[12px]">
                        {recentDocs.map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between">
                                <span className="font-mono text-primary-700">{doc.id}</span>
                                <StatusTag status={doc.status} severity={doc.severity} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerContextRail;
