import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

/** A single editable option row in the modifier-group form. */
export interface OptionRow {
    key: string;
    id?: string;
    name: string;
    priceDelta: string;   // kept as a string for the number input; parsed on save
    itemId: string;       // '' = price-only option (no linked item)
    sortOrder: number;
    isActive: boolean;
}

export interface ItemPickOption {
    value: string;
    label: string;
}

let rowSeq = 0;
export const newOptionRow = (): OptionRow => ({
    key: `opt-${++rowSeq}-${Date.now()}`,
    name: '',
    priceDelta: '0',
    itemId: '',
    sortOrder: 0,
    isActive: true,
});

interface Props {
    options: OptionRow[];
    onChange: (rows: OptionRow[]) => void;
    itemOptions: ItemPickOption[];
}

/**
 * Nested options editor for a modifier group: add/remove rows, each with a name,
 * an "Extra price" (priceDelta, tax-inclusive, may be 0), an optional linked Item
 * (blank = price-only option), a sort order and an active flag.
 */
const ModifierOptionsEditor = ({ options, onChange, itemOptions }: Props): React.ReactElement => {
    const update = (key: string, patch: Partial<OptionRow>) =>
        onChange(options.map((o) => (o.key === key ? { ...o, ...patch } : o)));

    const remove = (key: string) => onChange(options.filter((o) => o.key !== key));

    const add = () => onChange([...options, { ...newOptionRow(), sortOrder: options.length }]);

    return (
        <div className="col-span-12">
            <div className="flex items-center justify-between mb-2">
                <label className="form-label mb-0">Options</label>
                <button
                    type="button"
                    onClick={add}
                    className="btn btn-secondary flex items-center gap-1 text-xs"
                >
                    <Plus size={14} /> Add option
                </button>
            </div>

            {options.length === 0 ? (
                <p className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded-md p-3 text-center">
                    No options yet. Add at least one choice (e.g. "Large", "Extra shot").
                </p>
            ) : (
                <div className="space-y-2">
                    <div className="hidden md:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-neutral-500">
                        <div className="col-span-4">Name</div>
                        <div className="col-span-2">Extra price</div>
                        <div className="col-span-3">Linked item (optional)</div>
                        <div className="col-span-1">Sort</div>
                        <div className="col-span-1">Active</div>
                        <div className="col-span-1" />
                    </div>
                    {options.map((o) => (
                        <div key={o.key} className="grid grid-cols-12 gap-2 items-center">
                            <input
                                type="text"
                                className="col-span-12 md:col-span-4 h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                placeholder="Option name"
                                value={o.name}
                                onChange={(e) => update(o.key, { name: e.target.value })}
                            />
                            <input
                                type="number"
                                step="any"
                                className="col-span-6 md:col-span-2 h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                placeholder="0"
                                value={o.priceDelta}
                                onChange={(e) => update(o.key, { priceDelta: e.target.value })}
                            />
                            <select
                                className="col-span-6 md:col-span-3 h-9 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={o.itemId}
                                onChange={(e) => update(o.key, { itemId: e.target.value })}
                            >
                                <option value="">— No linked item —</option>
                                {itemOptions.map((it) => (
                                    <option key={it.value} value={it.value}>{it.label}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                className="col-span-4 md:col-span-1 h-9 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={o.sortOrder}
                                onChange={(e) => update(o.key, { sortOrder: Number(e.target.value) || 0 })}
                            />
                            <div className="col-span-4 md:col-span-1 flex items-center justify-center">
                                <input
                                    type="checkbox"
                                    checked={o.isActive}
                                    onChange={(e) => update(o.key, { isActive: e.target.checked })}
                                    className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                                    aria-label="Option active"
                                />
                            </div>
                            <div className="col-span-4 md:col-span-1 flex items-center justify-end">
                                <button
                                    type="button"
                                    onClick={() => remove(o.key)}
                                    className="p-1.5 text-neutral-500 hover:text-danger-600"
                                    aria-label="Remove option"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-xs text-neutral-500 mt-2">
                "Extra price" is added to the item price when the option is chosen (tax-inclusive; use 0 for free choices).
            </p>
        </div>
    );
};

export default ModifierOptionsEditor;
