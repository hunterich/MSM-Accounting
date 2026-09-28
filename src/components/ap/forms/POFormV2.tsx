import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Send, Search, Package, X } from 'lucide-react';

import DocumentFormLayout from '../../documents/DocumentFormLayout';
import LineItemsTable from '../../documents/LineItemsTable';
import AdditionalCostsTable from '../../documents/AdditionalCostsTable';
import AdditionalInfoTab, { type TaxState } from '../../documents/AdditionalInfoTab';
import DocumentTotals from '../../documents/DocumentTotals';
import VendorContextRail, { type RecentDoc } from './VendorContextRail';
import { useDocumentLines } from '../../documents/useDocumentLines';
import { computeTotals } from '../../documents/computeTotals';
import type { DocLine } from '../../documents/types';

import SearchableSelect from '../../UI/SearchableSelect';
import Button from '../../UI/Button';
import { formatIDR } from '../../../utils/formatters';
import {
    useVendors,
    usePurchaseOrders,
    usePurchaseOrder,
    useCreatePurchaseOrder,
    useUpdatePurchaseOrder,
    useCreateVendor,
} from '../../../hooks/useAP';
import { useItems } from '../../../hooks/useInventory';
import { useAccountsByType, useChartOfAccounts } from '../../../hooks/useGL';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { resolveAccountDefaults } from '../../../../lib/account-defaults';

/**
 * POFormV2 — Purchase Order on the shared document-form system.
 *
 * Vendor-side sibling of SOFormV2: same shell, tabs, totals; uses VendorContextRail
 * instead of the credit-limit rail, and posts the PO create/update payload.
 *
 * Additional costs ARE persisted (PurchaseOrderCharge) but a PO never journals,
 * so they're advisory here — they carry into the Bill (which posts them to GL)
 * when a bill is raised against this PO. Each charge codes to an Expense account.
 */

const TAX_RATE = 11;
const todayString = (): string => new Date().toISOString().slice(0, 10);

type Rec = { id: string } & Record<string, unknown>;
const str = (v: unknown): string => String(v ?? '').trim();
const firstStr = (...vals: unknown[]): string => vals.map(str).find(Boolean) || '';
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Next free VND-#### code, matching the Vendors form's numbering. */
const nextVendorCode = (vendors: Rec[]): string => {
    const max = vendors.reduce((m, v) => {
        const match = str(v.code).match(/^VND-(\d+)$/);
        return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return `VND-${String(max + 1).padStart(4, '0')}`;
};

const OPEN_BILL_STATUSES = new Set(['unpaid', 'overdue', 'pending', 'partial']);

interface POFormV2Props {
    mode?: 'create' | 'edit';
    recordId?: string;
    workspaceTabId?: string;
}

const POFormV2: React.FC<POFormV2Props> = ({ mode = 'create', recordId, workspaceTabId }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // In the workspace, identity comes from the owning tab (props), not the URL
    // which is shared and races across keep-alive tabs.
    const inWorkspace = workspaceTabId != null;
    const poId = inWorkspace ? (recordId ?? '') : (searchParams.get('poId') || '');
    const isEdit = mode === 'edit' || !!poId;

    // ── Data ────────────────────────────────────────────────────────────────
    const { data: vendorsResult } = useVendors();
    const { data: itemsResult } = useItems({ limit: 100 });
    const { data: posResult } = usePurchaseOrders();
    const { data: editingPORaw } = usePurchaseOrder(isEdit ? poId : undefined);
    const editingPO = editingPORaw as unknown as Rec | undefined;
    const { data: expenseAccountsData } = useAccountsByType('Expense');
    const accountOptions = useMemo(
        () => (expenseAccountsData ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
        [expenseAccountsData],
    );

    const createPO = useCreatePurchaseOrder();
    const updatePO = useUpdatePurchaseOrder();

    const vendors = useMemo<Rec[]>(() => ((vendorsResult?.data as unknown as Rec[]) || []), [vendorsResult?.data]);
    const inventoryItems = useMemo<Rec[]>(() => ((itemsResult?.data as unknown as Rec[]) || []), [itemsResult?.data]);
    const pos = useMemo<Rec[]>(() => ((posResult?.data as unknown as Rec[]) || []), [posResult?.data]);

    // ── Header ──────────────────────────────────────────────────────────────
    const [vendorId, setVendorId] = useState('');
    // "Auto" lets the server allocate PO-####; "Manual" sends the typed number
    // (a duplicate comes back as a 409 and is shown in the save alert).
    const [numberingMode, setNumberingMode] = useState<'auto' | 'manual'>('auto');
    const [manualNumber, setManualNumber] = useState('');
    const [orderDate, setOrderDate] = useState(todayString());
    const [expectedDate, setExpectedDate] = useState('');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [autoClose, setAutoClose] = useState('60');
    const [tax, setTax] = useState<TaxState>({ on: false, rate: TAX_RATE, mode: 'exclusive' });

    // ── Lines ───────────────────────────────────────────────────────────────
    const seedLines = useMemo<DocLine[]>(() => {
        const src = (editingPO?.items || editingPO?.lines || []) as Rec[];
        return src.map((l, i) => ({
            id: str(l.id) || `li-${i}`,
            productId: firstStr(l.itemId, l.productId),
            code: firstStr(l.code),
            description: firstStr(l.description),
            qty: num(l.quantity ?? l.qty),
            unit: str(l.unit) || 'PCS',
            price: num(l.price),
            discount: num(l.discountPct ?? l.discount),
            taxRate: TAX_RATE,
        }));
    }, [editingPO]);

    const seedCharges = useMemo(() => {
        const src = (editingPO?.charges || []) as Rec[];
        return src.map((c, i) => ({
            id: str(c.id) || `ch-${i}`,
            label: firstStr(c.label),
            accountId: firstStr(c.accountId),
            accountLabel: '',
            amount: num(c.amount),
            taxRate: num(c.taxRate),
        }));
    }, [editingPO]);

    const doc = useDocumentLines(seedLines, seedCharges);
    const { setLines, setCharges } = doc;

    useEffect(() => {
        if (!editingPO) return;
        setVendorId(str(editingPO.vendorId));
        setOrderDate(str(editingPO.date ?? editingPO.issueDate) || todayString());
        setExpectedDate(str(editingPO.expectedDate ?? editingPO.expiryDate));
        setNotes(str(editingPO.notes));
        setLines(seedLines);
        setCharges(seedCharges);
    }, [editingPO, seedLines, seedCharges, setLines, setCharges]);

    const [activeTab, setActiveTab] = useState<'items' | 'costs' | 'info'>('items');
    const [saving, setSaving] = useState(false);

    // ── Product search-to-add ───────────────────────────────────────────────
    const [itemSearch, setItemSearch] = useState('');
    const [showResults, setShowResults] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const filteredProducts = useMemo<Rec[]>(() => {
        const term = itemSearch.trim().toLowerCase();
        if (!term) return [];
        return inventoryItems
            .filter((it) =>
                str(it.name).toLowerCase().includes(term) ||
                str(it.code).toLowerCase().includes(term) ||
                str(it.sku).toLowerCase().includes(term) ||
                str(it.description).toLowerCase().includes(term))
            .slice(0, 8);
    }, [itemSearch, inventoryItems]);

    const addProduct = (it: Rec) => {
        doc.addLine({
            productId: str(it.id),
            code: firstStr(it.code, it.sku),
            description: firstStr(it.name, it.description),
            qty: 1,
            unit: firstStr(it.buyUnit, it.unit) || 'PCS',
            price: num(it.costPrice ?? it.price),
            discount: 0,
            taxRate: TAX_RATE,
            stock: num(it.currentStock ?? it.stock),
        });
        setItemSearch('');
        setShowResults(false);
    };

    const addCustomLine = () => {
        if (!itemSearch.trim()) return;
        doc.addLine({ description: itemSearch.trim(), taxRate: TAX_RATE });
        setItemSearch('');
        setShowResults(false);
    };

    // ── Totals ──────────────────────────────────────────────────────────────
    const totals = useMemo(
        () => computeTotals(doc.lines, doc.charges, { taxOn: tax.on, taxRate: tax.rate, taxMode: tax.mode }),
        [doc.lines, doc.charges, tax],
    );

    // ── Vendor context ──────────────────────────────────────────────────────
    const vendor = useMemo(() => vendors.find((v) => v.id === vendorId), [vendors, vendorId]);
    const taxId = vendor ? firstStr(vendor.npwp, vendor.taxId) : '';
    const terms = vendor ? str(vendor.paymentTerms) : '';
    const outstanding = vendor ? num(vendor.balance) : 0;

    const recentDocs = useMemo<RecentDoc[]>(
        () => pos.filter((p) => str(p.vendorId) === vendorId).slice(0, 3).map((p) => ({
            id: firstStr(p.number, p.id),
            status: str(p.status).toLowerCase() || 'draft',
        })),
        [pos, vendorId],
    );

    const vendorOptions = useMemo(
        () => vendors.map((v) => ({
            value: v.id,
            label: firstStr(v.name, v.code),
            subLabel: firstStr(v.email, v.phone, v.code),
        })),
        [vendors],
    );

    // ── Inline quick-create vendor ──────────────────────────────────────────
    const createVendor = useCreateVendor();
    const { data: chartOfAccounts = [], isLoading: accountsLoading } = useChartOfAccounts();
    const accountDefaultsConfig = useSettingsStore((s) => s.accountDefaults);
    const fallbackApAccountId = useMemo(() => {
        const resolved = resolveAccountDefaults(chartOfAccounts, accountDefaultsConfig).apControl;
        if (resolved) return resolved;
        const liability = chartOfAccounts.find(
            (a) => a.isActive && a.isPostable && String(a.type).toLowerCase() === 'liability',
        );
        return liability?.id || '';
    }, [chartOfAccounts, accountDefaultsConfig]);
    const [showNewVendor, setShowNewVendor] = useState(false);
    const [newVendorName, setNewVendorName] = useState('');
    const [newVendorError, setNewVendorError] = useState('');

    const openNewVendor = (term: string) => {
        setNewVendorName(term);
        setNewVendorError('');
        setShowNewVendor(true);
    };
    const closeNewVendor = () => { setShowNewVendor(false); setNewVendorName(''); setNewVendorError(''); };

    const handleQuickCreateVendor = async () => {
        const name = newVendorName.trim();
        if (!name) { setNewVendorError('Name is required.'); return; }
        if (accountsLoading) return;
        if (!fallbackApAccountId) {
            setNewVendorError('No Accounts Payable account found. Set one in Settings → Account defaults, or add the vendor from the Vendors page.');
            return;
        }
        try {
            const created = await createVendor.mutateAsync({
                code: nextVendorCode(vendors),
                name,
                status: 'Active',
                defaultApAccountId: fallbackApAccountId,
            } as Parameters<typeof createVendor.mutateAsync>[0]) as { id: string };
            setVendorId(created.id);
            closeNewVendor();
        } catch (e) {
            setNewVendorError(e instanceof Error ? e.message : 'Failed to create vendor.');
        }
    };

    const dirty = doc.dirty || !!vendorId || !!expectedDate || !!notes;

    // ── Save ────────────────────────────────────────────────────────────────
    const validate = (): boolean => {
        if (!vendorId) { setActiveTab('items'); window.alert('Select a vendor first.'); return false; }
        if (!isEdit && numberingMode === 'manual' && !manualNumber.trim()) {
            window.alert('Enter a PO number, or switch PO Number back to Auto.'); return false;
        }
        if (doc.lines.filter((l) => l.description.trim()).length === 0) {
            setActiveTab('items'); window.alert('Add at least one line item.'); return false;
        }
        return true;
    };

    const buildPayload = (status: 'Draft' | 'Approved') => ({
        vendorId,
        ...(!isEdit && numberingMode === 'manual' && manualNumber.trim() && { number: manualNumber.trim() }),
        date: orderDate,
        // Blank "Expected" is optional — omit it rather than send '' (the API rejects a non-date string).
        ...(expectedDate && { expectedDate }),
        status,
        taxRate: tax.on ? tax.rate : 0,
        taxable: tax.on,
        taxInclusive: tax.mode === 'inclusive',
        subtotal: totals.subtotal,
        taxAmount: totals.tax,
        totalAmount: totals.grandTotal,
        notes: [reference && `Ref: ${reference}`, notes].filter(Boolean).join(' | '),
        lines: doc.lines
            .filter((l) => l.description.trim())
            .map((l, idx) => ({
                lineNo: idx + 1,
                ...(l.productId && { itemId: l.productId }),
                description: l.description.trim(),
                quantity: num(l.qty),
                unit: l.unit || 'PCS',
                price: num(l.price),
                discountPct: num(l.discount),
                lineTotal: Math.round(num(l.qty) * num(l.price) * (1 - num(l.discount) / 100) * 100) / 100,
            })),
        charges: doc.charges
            .filter((c) => c.label.trim() && num(c.amount) !== 0)
            .map((c, idx) => ({
                lineNo: idx + 1,
                label: c.label.trim(),
                ...(c.accountId && { accountId: c.accountId }),
                amount: num(c.amount),
                taxRate: num(c.taxRate),
            })),
    });

    const persist = async (status: 'Draft' | 'Approved'): Promise<boolean> => {
        if (!validate()) return false;
        setSaving(true);
        try {
            const payload = buildPayload(status);
            if (isEdit && editingPO) {
                await updatePO.mutateAsync({ id: str(editingPO._id || editingPO.id), ...payload });
            } else {
                await createPO.mutateAsync(payload);
            }
            return true;
        } catch (err) {
            window.alert(`Failed to save purchase order: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return false;
        } finally {
            setSaving(false);
        }
    };

    const goBack = () => navigate('/ap/pos');
    const handleSaveDraft = async () => { if (await persist('Draft')) goBack(); };
    const handleConfirm = async () => { if (await persist('Approved')) goBack(); };

    // ── UI ──────────────────────────────────────────────────────────────────
    const lbl = 'block mb-1 text-[12px] font-medium text-neutral-700';
    const ctl = 'w-full h-9 px-2.5 text-[13px] text-neutral-900 bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0 focus:ring-2 focus:ring-primary-100';

    const TabBtn = ({ id, label }: { id: typeof activeTab; label: string }) => (
        <button type="button" onClick={() => setActiveTab(id)}
            className={`relative inline-flex items-center gap-1.5 py-2 px-3.5 text-[13px] font-semibold border-b-2 transition-colors ${activeTab === id ? 'text-primary-700 border-primary-600' : 'text-neutral-600 border-transparent hover:text-neutral-900'}`}>
            {label}
        </button>
    );

    const searchSlot = (
        <div className="relative w-80" ref={searchRef}>
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
                value={itemSearch}
                onChange={(e) => { setItemSearch(e.target.value); setShowResults(true); }}
                onFocus={() => setShowResults(true)}
                placeholder="Search SKU or name to add…"
                className="w-full h-8 pl-8 pr-3 rounded-md border border-neutral-300 bg-white text-[13px] focus:border-primary-500 focus:outline-none"
            />
            {showResults && itemSearch.trim() && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-[280px] overflow-y-auto z-50">
                    {filteredProducts.length > 0 ? filteredProducts.map((p) => (
                        <div key={p.id} onClick={() => addProduct(p)}
                            className="px-3 py-2 flex justify-between items-center cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                            <div className="min-w-0">
                                <div className="text-[13px] font-medium text-neutral-900 truncate">{firstStr(p.name, p.description)}</div>
                                <div className="text-[11px] text-neutral-500">{firstStr(p.code, p.sku)} · Stock {num(p.currentStock ?? p.stock).toLocaleString()}</div>
                            </div>
                            <div className="text-[13px] font-semibold text-success-600 tabular-nums">{formatIDR(num(p.costPrice ?? p.price))}</div>
                        </div>
                    )) : (
                        <div onClick={addCustomLine} className="px-3 py-2.5 text-center text-[13px] text-primary-700 cursor-pointer hover:bg-primary-50">
                            <Package size={14} className="inline mr-1.5" />Add “{itemSearch.trim()}” as a custom line
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const main = (
        <>
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-5">
                        <SearchableSelect
                            label={<>Vendor <span className="text-danger-500">*</span></>}
                            options={vendorOptions}
                            value={vendorId}
                            onChange={(val) => { setVendorId(val); closeNewVendor(); }}
                            onAddNew={openNewVendor}
                            footerAction={{ label: 'Add new vendor', onAction: openNewVendor }}
                            placeholder="Search & select vendor…"
                        />
                        {showNewVendor && (
                            <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 -mt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New vendor</span>
                                    <button type="button" onClick={closeNewVendor} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                                </div>
                                <input
                                    placeholder="Vendor name *"
                                    value={newVendorName}
                                    autoFocus
                                    onChange={(e) => { setNewVendorName(e.target.value); setNewVendorError(''); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleQuickCreateVendor(); } }}
                                    className={`${ctl} mb-2`}
                                />
                                {newVendorError && <div className="text-xs text-danger-600 mb-2">{newVendorError}</div>}
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-neutral-500">Fill in email, NPWP and terms later on the Vendors page.</span>
                                    <Button
                                        text={createVendor.isPending ? 'Creating…' : 'Create & select'}
                                        variant="primary"
                                        size="small"
                                        disabled={createVendor.isPending || accountsLoading}
                                        onClick={handleQuickCreateVendor}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="col-span-3">
                        <label className={lbl}>PO Number</label>
                        {isEdit ? (
                            <div className={`${ctl} flex items-center font-mono text-neutral-500`}>
                                {firstStr(editingPO?.number, poId)}
                            </div>
                        ) : (
                            <div className="flex gap-1">
                                <select
                                    aria-label="PO numbering"
                                    className={`${ctl} w-[84px] shrink-0 px-1.5`}
                                    value={numberingMode}
                                    onChange={(e) => setNumberingMode(e.target.value as 'auto' | 'manual')}
                                >
                                    <option value="auto">Auto</option>
                                    <option value="manual">Manual</option>
                                </select>
                                {numberingMode === 'auto' ? (
                                    <div className={`${ctl} flex items-center justify-end font-sans text-[11px] text-neutral-400 bg-neutral-50`}>
                                        assigned on save
                                    </div>
                                ) : (
                                    <input
                                        className={`${ctl} font-mono`}
                                        value={manualNumber}
                                        onChange={(e) => setManualNumber(e.target.value)}
                                        placeholder="e.g. PO-TC-0001"
                                        autoFocus
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Order date <span className="text-danger-500">*</span></label>
                        <input type="date" className={ctl} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Expected</label>
                        <input type="date" className={ctl} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                    </div>
                </div>
            </div>

            <div className="flex gap-1 border-b border-neutral-200 px-1">
                <TabBtn id="items" label="Items" />
                <TabBtn id="costs" label="Additional costs" />
                <TabBtn id="info" label="Additional info" />
            </div>

            {activeTab === 'items' && (
                <LineItemsTable lines={doc.lines} showTax={tax.on} onChange={doc.updateLine} onRemove={doc.removeLine} searchSlot={searchSlot} />
            )}
            {activeTab === 'costs' && (
                <AdditionalCostsTable charges={doc.charges} onChange={doc.updateCharge} onRemove={doc.removeCharge} onAdd={doc.addCharge} accountOptions={accountOptions} />
            )}
            {activeTab === 'info' && (
                <AdditionalInfoTab
                    party="vendor"
                    tax={tax}
                    onTaxChange={(next) => setTax((t) => ({ ...t, ...next }))}
                    deliveryDate={expectedDate}
                    onDeliveryDateChange={setExpectedDate}
                    reference={reference}
                    onReferenceChange={setReference}
                    isOrder
                    autoClose={autoClose}
                    onAutoCloseChange={setAutoClose}
                />
            )}

            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <label className={lbl}>Notes for vendor / internal</label>
                <textarea className={`${ctl} h-[68px] py-2 resize-y`} placeholder="Optional notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
        </>
    );

    const rail = (
        <>
            <DocumentTotals totals={totals} taxRate={tax.on ? tax.rate : undefined} />
            <VendorContextRail
                hasVendor={!!vendorId}
                vendorName={firstStr(vendor?.name) || 'Vendor'}
                taxId={taxId}
                outstanding={outstanding}
                terms={terms}
                recentDocs={recentDocs}
                recentLabel="Recent purchase orders"
            />
        </>
    );

    return (
        <div className="p-0">
            <DocumentFormLayout
                title={isEdit ? 'Edit Purchase Order' : 'New Purchase Order'}
                dirty={dirty}
                saving={saving}
                onBack={goBack}
                backLabel="Purchase Orders"
                printOptions={[
                    { label: 'Print A4', hint: 'Standard paper', onClick: () => window.print() },
                    { label: 'Email PDF', onClick: () => {} },
                ]}
                onSaveDraft={handleSaveDraft}
                primaryLabel="Save & send to vendor"
                primaryIcon={<Send size={13} />}
                onPrimary={handleConfirm}
                primaryOptions={[
                    { label: 'Save & send to vendor', hint: 'Approve the PO', onClick: handleConfirm },
                    { label: 'Save as draft', hint: 'Keep editable', onClick: handleSaveDraft },
                ]}
                main={main}
                rail={rail}
            />
        </div>
    );
};

export default POFormV2;
