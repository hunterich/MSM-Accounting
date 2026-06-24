import React from 'react';
import { X, Plus } from 'lucide-react';
import type { DocCharge } from './types';

/**
 * AdditionalCostsTable — delivery / insurance / entertainment / handling.
 *
 * The key accounting win over "fake a custom line item": every cost maps to its
 * own GL account (and tax code), so it posts to the right expense/clearing
 * account instead of polluting sales revenue.
 */

interface AdditionalCostsTableProps {
    charges: DocCharge[];
    onChange: (id: string, key: keyof DocCharge, value: string | number) => void;
    onRemove: (id: string) => void;
    onAdd: () => void;
    /** account options for the GL select (host supplies from chart of accounts) */
    accountOptions?: { value: string; label: string }[];
}

const cell =
    'w-full h-7 px-2 text-[13px] bg-transparent border border-transparent rounded text-neutral-900 ' +
    'hover:border-neutral-200 focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 focus:outline-none';

const AdditionalCostsTable = ({
    charges,
    onChange,
    onRemove,
    onAdd,
    accountOptions = [],
}: AdditionalCostsTableProps): React.ReactElement => (
    <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
            <div className="text-[13px] font-semibold text-neutral-800">Additional costs</div>
            <span className="text-[11px] text-neutral-500">delivery · insurance · entertainment · handling</span>
        </div>

        <table className="w-full border-collapse text-[13px]">
            <thead>
                <tr className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="text-left font-semibold px-3 py-2">Cost</th>
                    <th className="text-left font-semibold px-2 py-2">GL account</th>
                    <th className="text-right font-semibold px-2 py-2 w-16">Tax%</th>
                    <th className="text-right font-semibold px-3 py-2 w-32">Amount</th>
                    <th className="w-8" />
                </tr>
            </thead>
            <tbody>
                {charges.map((c) => (
                    <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                        <td className="px-3 py-1.5">
                            <input
                                value={c.label}
                                onChange={(e) => onChange(c.id, 'label', e.target.value)}
                                placeholder="e.g. Delivery / freight"
                                className={cell + ' px-0 hover:border-transparent'}
                            />
                        </td>
                        <td className="px-2 py-1.5">
                            {accountOptions.length > 0 ? (
                                <select
                                    value={c.accountId}
                                    onChange={(e) => onChange(c.id, 'accountId', e.target.value)}
                                    className={`${cell} font-mono text-[11px]`}
                                >
                                    {accountOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            ) : (
                                <span className="font-mono text-[11px] text-neutral-500">{c.accountLabel}</span>
                            )}
                        </td>
                        <td className="px-2 py-1.5">
                            <input type="number" value={c.taxRate ?? 0} onChange={(e) => onChange(c.id, 'taxRate', Number(e.target.value || 0))} className={`${cell} text-right tabular-nums`} />
                        </td>
                        <td className="px-3 py-1.5">
                            <input type="number" value={c.amount} onChange={(e) => onChange(c.id, 'amount', Number(e.target.value || 0))} className={`${cell} text-right tabular-nums font-semibold`} />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                            <button type="button" onClick={() => onRemove(c.id)} className="text-neutral-300 hover:text-danger-500" aria-label="Remove cost">
                                <X size={15} />
                            </button>
                        </td>
                    </tr>
                ))}
                {charges.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-[12px] text-neutral-400">No additional costs. Add delivery, insurance, handling, etc.</td></tr>
                )}
            </tbody>
        </table>

        <button type="button" onClick={onAdd} className="w-full text-left px-3 py-2 text-[13px] text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1.5">
            <Plus size={14} /> Add cost
        </button>
    </div>
);

export default AdditionalCostsTable;
