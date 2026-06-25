import React from 'react';

/**
 * AdditionalInfoTab — the "Additional info" tab body shared by line-item documents.
 *
 * Holds the settings that aren't part of the line grid:
 *  - PPN tax: off by default; when on, choose "Add on top" (exclusive) vs "Total already includes" (inclusive)
 *  - Delivery date
 *  - Required reference number (Customer order # for AR, Supplier's invoice # for AP) — enforced on save
 *  - Auto-close window (orders only) so unfulfilled SO/PO don't stay open forever
 *
 * Fully controlled — parent owns the values and validation flag.
 */

export interface TaxState {
    on: boolean;
    rate: number;
    mode: 'exclusive' | 'inclusive';
}

interface AdditionalInfoTabProps {
    party: 'customer' | 'vendor';
    tax: TaxState;
    onTaxChange: (next: Partial<TaxState>) => void;
    deliveryDate: string;
    onDeliveryDateChange: (v: string) => void;
    reference: string;
    onReferenceChange: (v: string) => void;
    /** true after a save attempt with empty reference */
    referenceError?: boolean;
    /** orders only — show the auto-close control */
    isOrder?: boolean;
    autoClose?: string;
    onAutoCloseChange?: (v: string) => void;
    /**
     * AP bills only — PPh income-tax withholding. When supplied, a withholding
     * selector is shown; `amount` is the computed rupiah withheld (display).
     */
    withholding?: {
        rate: number;
        onChange: (rate: number) => void;
        amount: number;
    };
}

/** Common Indonesian PPh withholding presets. Operators can pick the article. */
const PPH_PRESETS: { value: number; label: string }[] = [
    { value: 0, label: 'No withholding' },
    { value: 2, label: 'PPh 23 — services / rent / royalty (2%)' },
    { value: 4, label: 'PPh 23 — non-NPWP vendor (4%)' },
    { value: 10, label: 'PPh 4(2) — land / building rent (10%)' },
];

const ctl =
    'w-full h-9 px-2.5 text-[13px] text-neutral-900 bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0 focus:ring-2 focus:ring-primary-100';

const fmtIDR = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

const AdditionalInfoTab = ({
    party, tax, onTaxChange, deliveryDate, onDeliveryDateChange,
    reference, onReferenceChange, referenceError, isOrder, autoClose, onAutoCloseChange,
    withholding,
}: AdditionalInfoTabProps): React.ReactElement => {
    const refLabel = party === 'vendor' ? "Supplier's invoice #" : 'Customer order # (PO)';
    const refMissing = referenceError && !reference.trim();

    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-6">
                {/* Tax */}
                <div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">Tax</div>
                    <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={tax.on} onChange={(e) => onTaxChange({ on: e.target.checked })} className="accent-primary-600 w-4 h-4" />
                        <span className="text-[13px] font-medium text-neutral-900">With PPN {tax.rate}%</span>
                    </label>
                    <div className="text-[12px] text-neutral-500 mt-1 mb-3">Off by default — tick to apply PPN to this document.</div>
                    {tax.on && (
                        <div className="flex flex-col gap-2">
                            {([
                                ['exclusive', 'Add PPN on top', 'Prices exclude tax; PPN is added to the total.'],
                                ['inclusive', 'Total already includes PPN', 'Prices already include tax; PPN is extracted from it.'],
                            ] as const).map(([val, label, hint]) => {
                                const active = tax.mode === val;
                                return (
                                    <button key={val} type="button" onClick={() => onTaxChange({ mode: val })}
                                        className={`flex items-start gap-2.5 text-left p-2.5 rounded-lg border transition-colors ${active ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-100' : 'border-neutral-200 bg-white hover:border-neutral-300'}`}>
                                        <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${active ? 'border-primary-500' : 'border-neutral-300'}`}>
                                            {active && <span className="w-2 h-2 rounded-full bg-primary-600" />}
                                        </span>
                                        <span>
                                            <span className="text-[13px] text-neutral-900 font-medium">{label}</span>
                                            <span className="block text-[11px] text-neutral-500 mt-0.5">{hint}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Dates & reference */}
                <div className="flex flex-col gap-3">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-1">Dates &amp; reference</div>
                    <div>
                        <label className="block mb-1 text-[12px] font-medium text-neutral-700">Delivery date</label>
                        <input type="date" value={deliveryDate} onChange={(e) => onDeliveryDateChange(e.target.value)} className={ctl} />
                    </div>
                    <div>
                        <label className="block mb-1 text-[12px] font-medium text-neutral-700">{refLabel} <span className="text-danger-500">*</span></label>
                        <input
                            value={reference}
                            onChange={(e) => onReferenceChange(e.target.value)}
                            placeholder={party === 'vendor' ? 'e.g. INV/DE/8842' : 'e.g. PO-2026-0142'}
                            className={`w-full h-9 px-2.5 text-[13px] font-mono bg-white border rounded-md focus:outline-0 focus:ring-2 ${refMissing ? 'border-danger-500 ring-danger-100' : 'border-neutral-300 focus:border-primary-500 focus:ring-primary-100'}`}
                        />
                        {refMissing && <div className="text-[11px] text-danger-600 mt-1">{refLabel} is required before saving.</div>}
                    </div>
                </div>
            </div>

            {/* PPh withholding — AP bills only */}
            {withholding && (
                <div className="mt-4 pt-4 border-t border-neutral-200">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">PPh withholding</div>
                    <div className="flex items-end gap-4">
                        <div>
                            <label className="block mb-1 text-[12px] font-medium text-neutral-700">Withholding type</label>
                            <select
                                value={PPH_PRESETS.some((p) => p.value === withholding.rate) ? withholding.rate : 'custom'}
                                onChange={(e) => { if (e.target.value !== 'custom') withholding.onChange(Number(e.target.value)); }}
                                className="w-80 h-9 px-2.5 text-[13px] bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                            >
                                {PPH_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                <option value="custom">Custom rate…</option>
                            </select>
                        </div>
                        <div>
                            <label className="block mb-1 text-[12px] font-medium text-neutral-700">Rate %</label>
                            <input
                                type="number" min={0} max={100} step={0.5}
                                value={withholding.rate}
                                onChange={(e) => withholding.onChange(Number(e.target.value) || 0)}
                                className="w-24 h-9 px-2.5 text-[13px] text-right tabular-nums bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                            />
                        </div>
                        {withholding.rate > 0 && (
                            <div className="text-[12px] text-neutral-600 pb-2">
                                Withheld: <span className="font-semibold tabular-nums text-neutral-900">{fmtIDR(withholding.amount)}</span>
                                <span className="block text-[11px] text-neutral-500">Deducted from the vendor payment, owed to the tax office.</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Order settings — orders only */}
            {isOrder && (
                <div className="mt-4 pt-4 border-t border-neutral-200">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">Order settings</div>
                    <label className="block mb-1 text-[12px] font-medium text-neutral-700">Auto-close order after</label>
                    <select value={autoClose} onChange={(e) => onAutoCloseChange?.(e.target.value)} className="w-64 h-9 px-2.5 text-[13px] bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0">
                        <option value="30">30 days</option>
                        <option value="60">60 days</option>
                        <option value="90">90 days</option>
                        <option value="never">Never (keep open)</option>
                    </select>
                    <div className="text-[12px] text-neutral-500 mt-1">Unfulfilled orders auto-close after this period so they don't stay open forever.</div>
                </div>
            )}
        </div>
    );
};

export default AdditionalInfoTab;
