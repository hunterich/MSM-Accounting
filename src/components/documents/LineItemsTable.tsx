import React from 'react';
import { Search, X, Plus } from 'lucide-react';
import { formatIDR } from '../../utils/formatters';
import { lineNet } from './computeTotals';
import type { DocLine } from './types';

/**
 * LineItemsTable — quiet inline editable table shared by all line-item documents.
 *
 * Design choices vs the old SO/Invoice tables:
 *  - cells are borderless until focus (no "wall of boxes" on a 20-line order)
 *  - SKU is monospace, amounts are tabular-nums and right-aligned
 *  - low-stock badge surfaces inventory state inline
 *  - per-line tax column shown only when `showTax`
 *
 * Fully controlled: the host owns the `lines` array and the mutation callbacks.
 */

interface LineItemsTableProps {
    lines: DocLine[];
    showTax?: boolean;
    onChange: (id: string, key: keyof DocLine, value: string | number) => void;
    onRemove: (id: string) => void;
    onAddLine: () => void;
    /** search box is presentational here; host wires the product autocomplete */
    searchSlot?: React.ReactNode;
    /** when true, the table is display-only (posted documents): no editing, no add/remove */
    readOnly?: boolean;
    /** per-line predicate to lock the price cell (e.g. catalog item without override permission) */
    isPriceLocked?: (line: DocLine) => boolean;
}

const TEXT_KEYS = new Set<keyof DocLine>(['description', 'unit', 'code']);

const cell =
    'w-full h-7 px-2 text-[13px] bg-transparent border border-transparent rounded text-neutral-900 ' +
    'hover:border-neutral-200 focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 focus:outline-none';

const LineItemsTable = ({
    lines,
    showTax = false,
    onChange,
    onRemove,
    onAddLine,
    searchSlot,
    readOnly = false,
    isPriceLocked,
}: LineItemsTableProps): React.ReactElement => {
    const handle = (id: string, key: keyof DocLine) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = TEXT_KEYS.has(key) ? e.target.value : Number(e.target.value || 0);
        onChange(id, key, v);
    };

    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
                <div className="text-[13px] font-semibold text-neutral-800">Items</div>
                {readOnly ? null : searchSlot ?? (
                    <div className="relative w-72">
                        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            placeholder="Search SKU or name to add…"
                            className="w-full h-8 pl-8 pr-3 rounded-md border border-neutral-300 bg-white text-[13px] focus:border-primary-500 focus:outline-none"
                        />
                    </div>
                )}
            </div>

            <table className="w-full border-collapse text-[13px]">
                <thead>
                    <tr className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                        <th className="text-left font-semibold px-3 py-2">Item</th>
                        <th className="text-right font-semibold px-2 py-2 w-16">Qty</th>
                        <th className="text-left font-semibold px-2 py-2 w-16">Unit</th>
                        <th className="text-right font-semibold px-2 py-2 w-28">Unit price</th>
                        <th className="text-right font-semibold px-2 py-2 w-16">Disc%</th>
                        {showTax && <th className="text-right font-semibold px-2 py-2 w-14">Tax</th>}
                        <th className="text-right font-semibold px-3 py-2 w-32">Amount</th>
                        <th className="w-8" />
                    </tr>
                </thead>
                <tbody>
                    {lines.length === 0 ? (
                        <tr>
                            <td colSpan={showTax ? 8 : 7} className="text-center py-8">
                                <div className="text-neutral-500 font-medium mb-0.5">No items yet</div>
                                <div className="text-neutral-400 text-xs">Use the search above to add products, or “Add line”.</div>
                            </td>
                        </tr>
                    ) : (
                        lines.map((l) => (
                            <tr key={l.id} className="border-b border-neutral-100 last:border-0">
                                <td className="px-3 py-1.5">
                                    <div className="flex items-center gap-1.5">
                                        {l.code && <span className="font-mono text-[11px] text-primary-700">{l.code}</span>}
                                        {typeof l.stock === 'number' && l.stock <= 10 && (
                                            <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold bg-warning-50 text-warning-800 border border-warning-200">
                                                Low: {l.stock}
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        value={l.description}
                                        onChange={handle(l.id, 'description')}
                                        placeholder="Description"
                                        disabled={readOnly}
                                        className={cell + ' px-0 hover:border-transparent disabled:bg-transparent'}
                                    />
                                </td>
                                <td className="px-2 py-1.5"><input type="number" value={l.qty} onChange={handle(l.id, 'qty')} disabled={readOnly} className={`${cell} text-right tabular-nums`} /></td>
                                <td className="px-2 py-1.5"><input value={l.unit} onChange={handle(l.id, 'unit')} disabled={readOnly} className={cell} /></td>
                                <td className="px-2 py-1.5"><input type="number" value={l.price} onChange={handle(l.id, 'price')} disabled={readOnly || isPriceLocked?.(l)} className={`${cell} text-right tabular-nums disabled:text-neutral-500`} /></td>
                                <td className="px-2 py-1.5"><input type="number" value={l.discount} onChange={handle(l.id, 'discount')} disabled={readOnly} className={`${cell} text-right tabular-nums`} /></td>
                                {showTax && <td className="px-2 py-1.5 text-right text-neutral-500 text-[12px]">{l.taxRate ?? 0}%</td>}
                                <td className="px-3 py-1.5 text-right font-semibold text-neutral-900 tabular-nums">{formatIDR(lineNet(l))}</td>
                                <td className="px-2 py-1.5 text-center">
                                    {!readOnly && (
                                        <button type="button" onClick={() => onRemove(l.id)} className="text-neutral-300 hover:text-danger-500" aria-label="Remove line">
                                            <X size={15} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>

            {!readOnly && (
                <button type="button" onClick={onAddLine} className="w-full text-left px-3 py-2 text-[13px] text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1.5">
                    <Plus size={14} /> Add line
                </button>
            )}
        </div>
    );
};

export default LineItemsTable;
