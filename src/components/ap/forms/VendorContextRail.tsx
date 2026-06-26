import React from 'react';
import { User, Clock } from 'lucide-react';
import { formatIDR } from '../../../utils/formatters';
import StatusTag from '../../UI/StatusTag';

/**
 * VendorContextRail — sticky right column for vendor-side documents (PO / Bill).
 *
 * The AP mirror of CustomerContextRail. Instead of a credit-limit gauge it shows
 * the vendor's open payable balance, payment terms, and recent bills, so an
 * operator has the context to raise a PO or enter a bill without leaving the form.
 *
 * Presentational only — the host form fetches and passes everything in.
 */

export interface RecentDoc {
    id: string;
    status: string;
    severity?: string;
}

interface VendorContextRailProps {
    vendorName: string;
    taxId?: string;
    /** open payable balance for this vendor */
    outstanding?: number;
    /** spend with this vendor in the current month (optional) */
    monthSpend?: number;
    /** payment terms label, e.g. "Net 30" */
    terms?: string;
    recentDocs?: RecentDoc[];
    recentLabel?: string;
    placeholder?: React.ReactNode;
    hasVendor: boolean;
}

const Money = ({ value }: { value: number }) => <span className="tabular-nums">{formatIDR(value)}</span>;

const VendorContextRail = ({
    vendorName, taxId, outstanding = 0, monthSpend, terms,
    recentDocs = [], recentLabel = 'Recent bills', placeholder, hasVendor,
}: VendorContextRailProps): React.ReactElement => {
    if (!hasVendor) {
        return (
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4 text-sm text-neutral-500">
                {placeholder ?? 'Select a vendor to see open balance and history.'}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Identity + summary */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                    <span className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500">
                        <User size={14} />
                    </span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900 leading-tight truncate">{vendorName}</div>
                        {taxId && <div className="text-[11px] text-neutral-500 truncate">NPWP {taxId}</div>}
                    </div>
                </div>

                <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-1.5">Vendor summary</div>
                <div className="flex flex-col gap-1.5 text-[12px]">
                    <div className="flex justify-between"><span className="text-neutral-500">Open bills</span><Money value={outstanding} /></div>
                    {typeof monthSpend === 'number' && (
                        <div className="flex justify-between"><span className="text-neutral-500">Spend this month</span><Money value={monthSpend} /></div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-neutral-500 inline-flex items-center gap-1"><Clock size={12} /> Payment terms</span>
                        <span className="text-neutral-900">{terms || 'Net 30'}</span>
                    </div>
                </div>
            </div>

            {/* Recent activity */}
            {recentDocs.length > 0 && (
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">{recentLabel}</div>
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

export default VendorContextRail;
