import React from 'react';
import { formatIDR, terbilang } from '../../utils/formatters';
import type { DocTotals } from './types';

/**
 * DocumentTotals — the money breakdown card, shared by every line-item document.
 * Renders only the rows that are non-zero, plus the Indonesian amount-in-words.
 */

interface DocumentTotalsProps {
    totals: DocTotals;
    taxRate?: number;
    withholdingRate?: number;
    showTerbilang?: boolean;
}

const Row = ({ k, v, strong, brand, negative }: { k: string; v: number; strong?: boolean; brand?: boolean; negative?: boolean }) => (
    <div className="flex justify-between items-baseline">
        <span className={strong ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>{k}</span>
        <span className={`tabular-nums ${brand ? 'font-bold text-primary-700 text-lg' : strong ? 'font-semibold text-neutral-900' : 'text-neutral-900'}`}>
            {negative ? '– ' : ''}{formatIDR(v)}
        </span>
    </div>
);

const DocumentTotals = ({
    totals,
    taxRate,
    withholdingRate,
    showTerbilang = true,
}: DocumentTotalsProps): React.ReactElement => {
    const { subtotal, chargesTotal, documentDiscount, tax, withholding, grandTotal } = totals;
    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-3">Summary</div>
            <div className="flex flex-col gap-2 text-[13px]">
                <Row k="Subtotal (items)" v={subtotal} />
                {chargesTotal > 0 && <Row k="Additional costs" v={chargesTotal} />}
                {documentDiscount > 0 && <Row k="Document discount" v={documentDiscount} negative />}
                {tax > 0 && <Row k={taxRate ? `PPN ${taxRate}%` : 'Tax'} v={tax} />}
                {withholding > 0 && <Row k={`PPh withholding${withholdingRate ? ` (${withholdingRate}%)` : ''}`} v={withholding} negative />}
                <div className="border-t border-neutral-200 mt-1 pt-2">
                    <Row k="Grand total" v={grandTotal} brand />
                </div>
                {showTerbilang && (
                    <div className="text-[11px] text-neutral-500 italic leading-snug mt-1">
                        Terbilang: {terbilang(grandTotal)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DocumentTotals;
