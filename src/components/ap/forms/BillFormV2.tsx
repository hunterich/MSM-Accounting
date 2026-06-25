import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Search, Package } from 'lucide-react';

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
import { formatIDR } from '../../../utils/formatters';
import {
    useVendors,
    useBills,
    useBill,
    useCreateBill,
    useUpdateBill,
} from '../../../hooks/useAP';
import { useItems } from '../../../hooks/useInventory';
import { useAccountsByType } from '../../../hooks/useGL';

/**
 * BillFormV2 — Vendor Bill on the shared document-form system.
 *
 * Vendor-side, settling document. Like the old BillForm it requires the vendor's
 * own invoice number (maps to `vendorInvoiceNo`) and a bill + due date, and posts
 * the bill (status "Unpaid") on save, or keeps it as a "Draft".
 *
 * Parity notes (decide before cutover):
 *  - Additional costs ARE persisted + journaled: each charge codes to its own GL
 *    account (BillCharge), posted as an extra expense debit by `postBillToLedger`.
 *  - Per-line expense GL accounts ARE wired: an expense line (no item) codes to an
 *    Expense account, sent as line `accountId` and posted by `postBillToLedger`.
 *  - PPh withholding IS wired: a rate on the pre-tax net is withheld from the
 *    vendor and credited to PPh-payable by `postBillToLedger`.
 */

const TAX_RATE = 11;
const todayString = (): string => new Date().toISOString().slice(0, 10);

type Rec = { id: string } & Record<string, unknown>;
const str = (v: unknown): string => String(v ?? '').trim();
const firstStr = (...vals: unknown[]): string => vals.map(str).find(Boolean) || '';
const num = (v: unknown): number => Number(v ?? 0) || 0;

const addDays = (iso: string, days: number): string => {
    if (!iso || !days) return iso;
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};

const termDays = (terms: string): number => {
    const m = terms.match(/(\d+)/);
    return m ? Number(m[1]) : 0;
};

interface BillFormV2Props {
    mode?: 'create' | 'edit';
}

const BillFormV2: React.FC<BillFormV2Props> = ({ mode = 'create' }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const billId = searchParams.get('billId') || '';
    const isEdit = mode === 'edit' || !!billId;

    // ── Data ────────────────────────────────────────────────────────────────
    const { data: vendorsResult } = useVendors();
    const { data: itemsResult } = useItems({ limit: 100 });
    const { data: billsResult } = useBills();
    const { data: expenseAccountsData } = useAccountsByType('Expense');
    const { data: editingBillRaw } = useBill(isEdit ? billId : undefined);
    const editingBill = editingBillRaw as unknown as Rec | undefined;

    const createBill = useCreateBill();
    const updateBill = useUpdateBill();

    const vendors = useMemo<Rec[]>(() => ((vendorsResult?.data as unknown as Rec[]) || []), [vendorsResult?.data]);
    const inventoryItems = useMemo<Rec[]>(() => ((itemsResult?.data as unknown as Rec[]) || []), [itemsResult?.data]);
    const bills = useMemo<Rec[]>(() => ((billsResult?.data as unknown as Rec[]) || []), [billsResult?.data]);

    // Expense accounts let an expense line (no item) post to its own GL account.
    const accountOptions = useMemo(
        () => (expenseAccountsData ?? []).map((a) => ({
            value: a.id,
            label: `${a.code} · ${a.name}`,
        })),
        [expenseAccountsData],
    );

    // ── Header ──────────────────────────────────────────────────────────────
    const [vendorId, setVendorId] = useState('');
    const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
    const [issueDate, setIssueDate] = useState(todayString());
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [tax, setTax] = useState<TaxState>({ on: false, rate: TAX_RATE, mode: 'exclusive' });
    const [withholdingRate, setWithholdingRate] = useState(0);
    const [refError, setRefError] = useState(false);

    // ── Lines ───────────────────────────────────────────────────────────────
    const seedLines = useMemo<DocLine[]>(() => {
        const src = (editingBill?.lines || editingBill?.items || []) as Rec[];
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
            accountId: firstStr(l.accountId),
        }));
    }, [editingBill]);

    const seedCharges = useMemo(() => {
        const src = (editingBill?.charges || []) as Rec[];
        return src.map((c, i) => ({
            id: str(c.id) || `ch-${i}`,
            label: firstStr(c.label),
            accountId: firstStr(c.accountId),
            accountLabel: firstStr(c.accountLabel),
            amount: num(c.amount),
            taxRate: num(c.taxRate),
        }));
    }, [editingBill]);

    const doc = useDocumentLines(seedLines, seedCharges);
    const { setLines, setCharges } = doc;

    useEffect(() => {
        if (!editingBill) return;
        setVendorId(str(editingBill.vendorId));
        setVendorInvoiceNo(str(editingBill.vendorInvoiceNo ?? editingBill.number));
        setIssueDate(str(editingBill.issueDate ?? editingBill.date) || todayString());
        setDueDate(str(editingBill.dueDate ?? editingBill.due));
        setNotes(str(editingBill.notes));
        if (typeof editingBill.taxAmount === 'number') setTax((t) => ({ ...t, on: num(editingBill.taxAmount) > 0 }));
        setWithholdingRate(num(editingBill.withholdingRate));
        setLines(seedLines);
        setCharges(seedCharges);
    }, [editingBill, seedLines, seedCharges, setLines, setCharges]);

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
        () => computeTotals(doc.lines, doc.charges, { taxOn: tax.on, taxRate: tax.rate, taxMode: tax.mode, withholdingRate }),
        [doc.lines, doc.charges, tax, withholdingRate],
    );

    // ── Vendor context ──────────────────────────────────────────────────────
    const vendor = useMemo(() => vendors.find((v) => v.id === vendorId), [vendors, vendorId]);
    const taxId = vendor ? firstStr(vendor.npwp, vendor.taxId) : '';
    const terms = vendor ? str(vendor.paymentTerms) : '';
    const outstanding = vendor ? num(vendor.balance) : 0;

    const recentDocs = useMemo<RecentDoc[]>(
        () => bills.filter((b) => str(b.vendorId) === vendorId && str(b.id) !== billId).slice(0, 3).map((b) => ({
            id: firstStr(b.number, b.vendorInvoiceNo, b.id),
            status: str(b.status).toLowerCase() || 'draft',
        })),
        [bills, vendorId, billId],
    );

    const vendorOptions = useMemo(
        () => vendors.map((v) => ({
            value: v.id,
            label: firstStr(v.name, v.code),
            subLabel: firstStr(v.email, v.phone, v.code),
        })),
        [vendors],
    );

    const handleVendorChange = (id: string) => {
        setVendorId(id);
        const v = vendors.find((x) => x.id === id);
        const days = termDays(str(v?.paymentTerms));
        if (!dueDate && days > 0 && issueDate) setDueDate(addDays(issueDate, days));
    };

    const dirty = doc.dirty || !!vendorId || !!vendorInvoiceNo || !!notes;

    // ── Save ────────────────────────────────────────────────────────────────
    const validate = (): boolean => {
        if (!vendorId) { setActiveTab('items'); window.alert('Select a vendor first.'); return false; }
        if (!vendorInvoiceNo.trim()) { setActiveTab('info'); setRefError(true); return false; }
        if (doc.lines.filter((l) => l.description.trim()).length === 0) {
            setActiveTab('items'); window.alert('Add at least one line item.'); return false;
        }
        return true;
    };

    const buildPayload = (status: 'Draft' | 'Unpaid') => ({
        vendorId,
        ...(vendorInvoiceNo.trim() && { vendorInvoiceNo: vendorInvoiceNo.trim() }),
        issueDate,
        ...(dueDate && { dueDate }),
        status,
        taxRate: tax.on ? tax.rate : 0,
        taxable: tax.on,
        taxInclusive: tax.mode === 'inclusive',
        withholdingRate,
        withholdingAmount: totals.withholding,
        subtotal: totals.subtotal,
        taxAmount: totals.tax,
        totalAmount: totals.grandTotal,
        notes,
        lines: doc.lines
            .filter((l) => l.description.trim())
            .map((l, idx) => ({
                lineNo: idx + 1,
                ...(l.productId && { itemId: l.productId }),
                ...(!l.productId && l.accountId && { accountId: l.accountId }),
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

    const persist = async (status: 'Draft' | 'Unpaid'): Promise<boolean> => {
        if (!validate()) return false;
        setSaving(true);
        try {
            const payload = buildPayload(status);
            if (isEdit && editingBill) {
                await updateBill.mutateAsync({ id: str(editingBill._id || editingBill.id), ...payload });
            } else {
                await createBill.mutateAsync(payload);
            }
            return true;
        } catch (err) {
            window.alert(`Failed to save bill: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return false;
        } finally {
            setSaving(false);
        }
    };

    const goBack = () => navigate('/ap/bills');
    const handleSaveDraft = async () => { if (await persist('Draft')) goBack(); };
    const handlePost = async () => { if (await persist('Unpaid')) goBack(); };

    // ── UI ──────────────────────────────────────────────────────────────────
    const lbl = 'block mb-1 text-[12px] font-medium text-neutral-700';
    const ctl = 'w-full h-9 px-2.5 text-[13px] text-neutral-900 bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0 focus:ring-2 focus:ring-primary-100';

    const TabBtn = ({ id, label, dot }: { id: typeof activeTab; label: string; dot?: boolean }) => (
        <button type="button" onClick={() => setActiveTab(id)}
            className={`relative inline-flex items-center gap-1.5 py-2 px-3.5 text-[13px] font-semibold border-b-2 transition-colors ${activeTab === id ? 'text-primary-700 border-primary-600' : 'text-neutral-600 border-transparent hover:text-neutral-900'}`}>
            {label}
            {dot && <span className="w-1.5 h-1.5 rounded-full bg-danger-500" />}
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

    const isPosted = isEdit && !!editingBill && !['DRAFT', 'PENDING_APPROVAL', ''].includes(str(editingBill.status).toUpperCase());

    const main = (
        <>
            {isPosted && (
                <div className="bg-warning-50 border border-warning-200 rounded-lg px-4 py-2.5 text-[12px] text-warning-800">
                    This bill is already posted. Saving your changes will <strong>reverse and re-post</strong> its journal entry (only while the period is open). Bills with payments, returns, or inventory items must be voided to change.
                </div>
            )}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4">
                        <SearchableSelect
                            label={<>Vendor <span className="text-danger-500">*</span></>}
                            options={vendorOptions}
                            value={vendorId}
                            onChange={handleVendorChange}
                            placeholder="Search & select vendor…"
                        />
                    </div>
                    <div className="col-span-3">
                        <label className={lbl}>Vendor's bill # <span className="text-danger-500">*</span></label>
                        <input
                            value={vendorInvoiceNo}
                            onChange={(e) => { setVendorInvoiceNo(e.target.value); setRefError(false); }}
                            placeholder="e.g. INV/DE/8842"
                            className={`w-full h-9 px-2.5 text-[13px] font-mono bg-white border rounded-md focus:outline-0 focus:ring-2 ${refError && !vendorInvoiceNo.trim() ? 'border-danger-500 ring-danger-100' : 'border-neutral-300 focus:border-primary-500 focus:ring-primary-100'}`}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Bill date <span className="text-danger-500">*</span></label>
                        <input type="date" className={ctl} value={issueDate}
                            onChange={(e) => {
                                setIssueDate(e.target.value);
                                const days = termDays(terms);
                                if (days > 0) setDueDate(addDays(e.target.value, days));
                            }} />
                    </div>
                    <div className="col-span-3">
                        <label className={lbl}>Due date</label>
                        <input type="date" className={ctl} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                </div>
            </div>

            <div className="flex gap-1 border-b border-neutral-200 px-1">
                <TabBtn id="items" label="Items" />
                <TabBtn id="costs" label="Additional costs" />
                <TabBtn id="info" label="Additional info" dot={refError && !vendorInvoiceNo.trim()} />
            </div>

            {activeTab === 'items' && (
                <LineItemsTable lines={doc.lines} showTax={tax.on} onChange={doc.updateLine} onRemove={doc.removeLine} onAddLine={doc.addLine} searchSlot={searchSlot} accountOptions={accountOptions} />
            )}
            {activeTab === 'costs' && (
                <AdditionalCostsTable charges={doc.charges} onChange={doc.updateCharge} onRemove={doc.removeCharge} onAdd={doc.addCharge} accountOptions={accountOptions} />
            )}
            {activeTab === 'info' && (
                <AdditionalInfoTab
                    party="vendor"
                    tax={tax}
                    onTaxChange={(next) => setTax((t) => ({ ...t, ...next }))}
                    deliveryDate={dueDate}
                    onDeliveryDateChange={setDueDate}
                    reference={vendorInvoiceNo}
                    onReferenceChange={(v) => { setVendorInvoiceNo(v); setRefError(false); }}
                    referenceError={refError}
                    withholding={{ rate: withholdingRate, onChange: setWithholdingRate, amount: totals.withholding }}
                />
            )}

            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <label className={lbl}>Notes</label>
                <textarea className={`${ctl} h-[68px] py-2 resize-y`} placeholder="Optional notes / PO reference…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
        </>
    );

    const rail = (
        <>
            <DocumentTotals totals={totals} taxRate={tax.on ? tax.rate : undefined} withholdingRate={withholdingRate || undefined} />
            <VendorContextRail
                hasVendor={!!vendorId}
                vendorName={firstStr(vendor?.name) || 'Vendor'}
                taxId={taxId}
                outstanding={outstanding}
                terms={terms}
                recentDocs={recentDocs}
                recentLabel="Recent bills"
            />
        </>
    );

    return (
        <div className="p-4 lg:p-6">
            <DocumentFormLayout
                title={isEdit ? 'Edit Bill' : 'New Bill'}
                dirty={dirty}
                saving={saving}
                onBack={goBack}
                backLabel="Bills"
                printOptions={[
                    { label: 'Print A4', hint: 'Standard paper', onClick: () => window.print() },
                    { label: 'Email PDF', onClick: () => {} },
                ]}
                onSaveDraft={handleSaveDraft}
                primaryLabel="Save & schedule payment"
                primaryIcon={<CheckCircle2 size={13} />}
                onPrimary={handlePost}
                primaryOptions={[
                    { label: 'Save & schedule payment', hint: 'Post the bill (Unpaid)', onClick: handlePost },
                    { label: 'Save as draft', hint: 'Keep editable, nothing posts', onClick: handleSaveDraft },
                ]}
                main={main}
                rail={rail}
            />
        </div>
    );
};

export default BillFormV2;
