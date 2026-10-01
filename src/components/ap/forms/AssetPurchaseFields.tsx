import React from 'react';
import type { DocLine } from '../../documents/types';
import type { Asset, AssetCategory } from '../../../hooks/useAssets';
import { formatIDR } from '../../../utils/formatters';

export default function AssetPurchaseFields({ line, categories, assets, cost, onChange, saved = false }: {
    line: DocLine; categories: AssetCategory[]; assets: Asset[]; cost: number;
    onChange: (value: DocLine['assetPurchase']) => void; saved?: boolean;
}) {
    if (line.productId) return null;
    const choice = line.assetPurchase;
    const selected = choice?.mode === 'LINK' ? assets.find(a => a.id === choice.assetId) : undefined;
    const category = categories.find(c => c.id === (choice?.mode === 'CREATE' ? choice.categoryId : selected?.categoryId));
    const control = 'h-8 w-full px-2 border border-neutral-300 rounded-md bg-white text-[12px]';
    const label = 'block text-[11px] font-medium text-neutral-600 mb-1';
    const create = () => onChange({ mode: 'CREATE', name: line.description, categoryId: '', salvageValue: 0 });
    return <div className={choice ? 'rounded-lg border border-primary-200 bg-primary-50 p-3' : 'pt-1'}>
        <div className="flex items-center justify-between gap-3">
            <label className="text-[12px] font-medium flex items-center gap-2">Purchase type
                <select aria-label="Purchase type" className={control} disabled={saved} value={choice ? 'ASSET' : 'EXPENSE'} onChange={e => e.target.value === 'ASSET' ? create() : onChange(undefined)}>
                    <option value="EXPENSE">Expense</option><option value="ASSET">Asset purchase</option>
                </select>
            </label>
            {choice && <span className="text-[12px] text-primary-800">Capitalized cost <strong>{formatIDR(cost)}</strong></span>}
        </div>
        {choice && <>
            <p className="text-[11px] text-neutral-600 mt-2 mb-3">One physical asset per line. Saving creates a draft asset; the bill posts its purchase cost once. Activate it when ready for use.</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <label><span className={label}>Asset register</span><select aria-label="Asset register" className={control} disabled={saved} value={choice.mode} onChange={e => e.target.value === 'CREATE' ? create() : onChange({ mode: 'LINK', assetId: '' })}>
                    <option value="CREATE">Create new asset</option><option value="LINK">Link draft asset</option>
                </select></label>
                {choice.mode === 'CREATE' ? <>
                    <label><span className={label}>Asset name *</span><input aria-label="Asset name" className={control} value={choice.name} onChange={e => onChange({ ...choice, name: e.target.value })} /></label>
                    <label><span className={label}>Category *</span><select aria-label="Asset category" className={control} value={choice.categoryId} onChange={e => {
                        const next = categories.find(c => c.id === e.target.value);
                        onChange({ ...choice, categoryId: e.target.value, usefulLifeMonths: next?.usefulLifeMonths, salvageValue: Math.round(cost * (next?.salvagePercent ?? 0)) / 100 });
                    }}><option value="">Select category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                    <label><span className={label}>Useful life (months)</span><input aria-label="Useful life months" className={control} type="number" min="1" value={choice.usefulLifeMonths ?? category?.usefulLifeMonths ?? 60} onChange={e => onChange({ ...choice, usefulLifeMonths: Number(e.target.value) })} /></label>
                    <label><span className={label}>Salvage value</span><input aria-label="Salvage value" className={control} type="number" min="0" max={cost} value={choice.salvageValue ?? 0} onChange={e => onChange({ ...choice, salvageValue: Number(e.target.value) })} /></label>
                    <label><span className={label}>Serial number</span><input aria-label="Asset serial number" className={control} value={choice.serialNumber ?? ''} onChange={e => onChange({ ...choice, serialNumber: e.target.value })} /></label>
                </> : <label className="col-span-2"><span className={label}>Draft asset *</span><select aria-label="Draft asset" className={control} disabled={saved} value={choice.assetId} onChange={e => onChange({ mode: 'LINK', assetId: e.target.value })}>
                    <option value="">Select an unlinked draft asset</option>{assets.map(a => <option key={a.id} value={a.id}>{a.assetNo} · {a.name}</option>)}
                    {saved && !selected && <option value={choice.assetId}>Linked asset</option>}
                </select></label>}
                <div className="col-span-2 text-[11px] text-neutral-600 self-center">
                    {category ? <><strong>{category.name}</strong> · {category.depreciationMethod.replaceAll('_', ' ').toLowerCase()}
                        {!category.assetAccountId && <p className="text-danger-600">Configure the category’s fixed-asset account before saving.</p>}</> : 'Configure categories and posting accounts in Assets → Categories.'}
                    {saved && <p><a className="text-primary-700 underline" href={`/assets/${choice.mode === 'LINK' ? choice.assetId : ''}`}>Open asset</a> · Manage life, salvage, and serial number in the asset register.</p>}
                </div>
            </div>
        </>}
    </div>;
}
