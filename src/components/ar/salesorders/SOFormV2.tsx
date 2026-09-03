import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Search, Package } from 'lucide-react';

import DocumentFormLayout from '../../documents/DocumentFormLayout';
import LineItemsTable from '../../documents/LineItemsTable';
import AdditionalCostsTable from '../../documents/AdditionalCostsTable';
import AdditionalInfoTab, { type TaxState } from '../../documents/AdditionalInfoTab';
import DocumentTotals from '../../documents/DocumentTotals';
import CustomerContextRail, { type RecentDoc } from './CustomerContextRail';
import { useDocumentLines } from '../../documents/useDocumentLines';
import { computeTotals } from '../../documents/computeTotals';
import type { DocLine } from '../../documents/types';

import SearchableSelect from '../../UI/SearchableSelect';
import { formatIDR, formatNumber } from '../../../utils/formatters';
import { useWorkspaceStore } from '../../../stores/useWorkspaceStore';
import { useCustomers, useInvoices, useSalesOrder, useCreateSalesOrder, useUpdateSalesOrder, useConvertSOToInvoice } from '../../../hooks/useAR';
import { useItems } from '../../../hooks/useInventory';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import SalesOrderPrintTemplate from '../../print/SalesOrderPrintTemplate';
import { useDraftAutosave } from '../../../hooks/useDraftAutosave';

/**
 * SOFormV2 — Sales Order on the shared document-form system.
 *
 * Thin host: header fields + data wiring + save. All heavy lifting (line table,
 * costs, totals math, layout, action bar) lives in /components/documents.
 *
 * Persistence note: the SO record + line items persist to the backend
 * (`/api/v1/sales-orders`). The backend SO schema has no columns for additional
 * costs, the tax breakdown, shipping address, or delivery notes, so those stay
 * display-only and re-default on reload. Tracked as a follow-up.
 */

const TAX_RATE = 11; // PPN
const todayString = (): string => new Date().toISOString().slice(0, 10);

type Rec = { id: string } & Record<string, unknown>;

const str = (v: unknown): string => String(v ?? '').trim();
const firstStr = (...vals: unknown[]): string => vals.map(str).find(Boolean) || '';
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Build a shipping address from a customer record. */
const buildShippingAddress = (c: Rec | undefined): string => {
    if (!c) return '';
    const direct = firstStr(c.shippingAddress, c.billingAddress);
    if (direct) return direct;
    return [c.address1, c.city, c.province].map(str).filter(Boolean).join(', ');
};

/** Open AR statuses that count toward a customer's outstanding balance. */
const OPEN_STATUSES = new Set(['unpaid', 'overdue', 'partial', 'sent', 'pending']);

interface SOFormV2Props {
    mode?: 'create' | 'edit';
    /** Present only when rendered inside the workspace shell. */
    workspaceTabId?: string;
    /** Record id when rendered inside the workspace (replaces the soId search param). */
    recordId?: string;
}

const SOFormV2: React.FC<SOFormV2Props> = ({ mode = 'create', workspaceTabId, recordId }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const soId = recordId ?? searchParams.get('soId') ?? '';
    const isEdit = mode === 'edit';

    // ── Server data ─────────────────────────────────────────────────────────
    const { data: customersResult } = useCustomers({ limit: 100 });
    const { data: itemsResult } = useItems({ limit: 100 });
    const { data: invoicesResult } = useInvoices({ limit: 100 });

    const { data: selectedSO = null } = useSalesOrder(isEdit ? soId : undefined);
    const createSO = useCreateSalesOrder();
    const updateSO = useUpdateSalesOrder();
    const convertSO = useConvertSOToInvoice();

    const draftSeed = useWorkspaceStore((s) =>
        (workspaceTabId ? s.tabs.find((t) => t.id === workspaceTabId)?.draft : undefined) as
            | Partial<{ customerId: string; orderDate: string; expectedDate: string; shippingAddress: string; deliveryNotes: string; reference: string; lines: DocLine[]; tax: TaxState }>
            | undefined,
    );

    const customers = useMemo<Rec[]>(
        () => ((customersResult?.data as unknown as Rec[]) || []),
        [customersResult?.data],
    );

    const inventoryItems = useMemo<Rec[]>(
        () => ((itemsResult?.data as unknown as Rec[]) || []),
        [itemsResult?.data],
    );
    const invoices = useMemo<Rec[]>(
        () => ((invoicesResult?.data as unknown as Rec[]) || []),
        [invoicesResult?.data],
    );

    // ── Header state ────────────────────────────────────────────────────────
    // In edit mode `selectedSO` arrives asynchronously, so the header is seeded
    // from the workspace draft (if any) and hydrated from `selectedSO` in the
    // effect below once the fetch resolves.
    const [customerId, setCustomerId] = useState(draftSeed?.customerId ?? '');
    const [orderDate, setOrderDate] = useState(draftSeed?.orderDate ?? todayString());
    const [expectedDate, setExpectedDate] = useState(draftSeed?.expectedDate ?? '');
    const [shippingAddress, setShippingAddress] = useState(draftSeed?.shippingAddress ?? '');
    const [deliveryNotes, setDeliveryNotes] = useState(draftSeed?.deliveryNotes ?? '');
    const [reference, setReference] = useState(draftSeed?.reference ?? '');
    const [autoClose, setAutoClose] = useState('60');
    const [tax, setTax] = useState<TaxState>(draftSeed?.tax ?? { on: false, rate: TAX_RATE, mode: 'exclusive' });

    // Hydrate the header once the SO loads. A workspace draft, if present, wins
    // and is left untouched. (Backend has no shipping/delivery columns.)
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current || draftSeed || !selectedSO) return;
        hydratedRef.current = true;
        setCustomerId(selectedSO.customerId || '');
        setOrderDate(selectedSO.issueDate || todayString());
        setExpectedDate(selectedSO.expiryDate || '');
    }, [selectedSO, draftSeed]);

    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [isPrintOpen, setIsPrintOpen] = useState(false);

    // ── Lines + charges (shared hook) ───────────────────────────────────────
    const seedLines = useMemo<DocLine[]>(() => {
        if (draftSeed?.lines && draftSeed.lines.length) return draftSeed.lines;
        if (!selectedSO) return [];
        return (selectedSO.items || []).map((l, i) => ({
            id: l.id || `li-${i}`,
            productId: l.productId || undefined,
            code: l.code || '',
            description: str(l.description),
            qty: num(l.quantity),
            unit: str(l.unit) || 'PCS',
            price: num(l.price),
            discount: num(l.discount),
        }));
    }, [draftSeed, selectedSO]);

    const doc = useDocumentLines(seedLines, []);
    const { setLines } = doc;

    // Reload lines when navigating between orders in edit mode.
    useEffect(() => {
        setLines(seedLines);
    }, [seedLines, setLines]);

    const [activeTab, setActiveTab] = useState<'items' | 'costs' | 'info'>('items');
    const [saving, setSaving] = useState(false);
    const [refError, setRefError] = useState(false);

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
            unit: firstStr(it.sellUnit, it.unit) || 'PCS',
            price: num(it.price),
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
        () => computeTotals(doc.lines, doc.charges, {
            taxOn: tax.on, taxRate: tax.rate, taxMode: tax.mode,
        }),
        [doc.lines, doc.charges, tax],
    );

    // ── Customer context ────────────────────────────────────────────────────
    const customer = useMemo(() => customers.find((c) => c.id === customerId), [customers, customerId]);
    const creditLimit = customer ? num(customer.creditLimit ?? customer.credit_limit) : 0;
    const taxId = customer ? firstStr(customer.npwp, customer.taxId, customer.tax_id) : '';

    const customerInvoices = useMemo(
        () => invoices.filter((inv) => str(inv.customerId) === customerId),
        [invoices, customerId],
    );
    const outstanding = useMemo(
        () => customerInvoices
            .filter((inv) => OPEN_STATUSES.has(str(inv.status).toLowerCase()))
            .reduce((s, inv) => s + num(inv.amount ?? inv.totalAmount), 0),
        [customerInvoices],
    );
    const recentDocs = useMemo<RecentDoc[]>(
        () => customerInvoices.slice(0, 3).map((inv) => ({
            id: firstStr(inv.number, inv.id),
            status: str(inv.status).toLowerCase() || 'draft',
        })),
        [customerInvoices],
    );

    const customerOptions = useMemo(
        () => customers.map((c) => ({
            value: c.id,
            label: firstStr(c.name, c.code),
            subLabel: firstStr(c.email, c.phone, c.code),
        })),
        [customers],
    );

    const handleCustomerChange = (id: string) => {
        setCustomerId(id);
        const c = customers.find((x) => x.id === id);
        if (c && !shippingAddress.trim()) setShippingAddress(buildShippingAddress(c));
    };

    const dirty = doc.dirty || !!expectedDate || !!deliveryNotes || !!reference;

    const snapshot = useMemo(() => ({
        customerId, orderDate, expectedDate, shippingAddress, deliveryNotes, reference, tax, lines: doc.lines,
    }), [customerId, orderDate, expectedDate, shippingAddress, deliveryNotes, reference, tax, doc.lines]);

    useDraftAutosave(workspaceTabId, snapshot);

    const setStatus = useWorkspaceStore((s) => s.setStatus);
    useEffect(() => {
        if (!workspaceTabId) return;
        setStatus(workspaceTabId, dirty ? (isEdit ? 'dirty' : 'new') : (isEdit ? 'clean' : 'new'));
    }, [workspaceTabId, dirty, isEdit, setStatus]);

    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const clearDraft = useWorkspaceStore((s) => s.clearDraft);

    // ── Save ────────────────────────────────────────────────────────────────
    const validate = (): boolean => {
        if (!customerId) { setActiveTab('items'); return false; }
        const validLines = doc.lines.filter((l) => l.description.trim());
        if (validLines.length === 0) { setActiveTab('items'); return false; }
        return true;
    };

    const persist = async (status: string): Promise<string | null> => {
        if (!validate()) return null;
        const customerName = firstStr(customer?.name) || selectedSO?.customerName || '';
        const items = doc.lines
            .filter((l) => l.description.trim())
            .map((l) => ({
                ...(l.productId ? { productId: l.productId } : {}),
                ...(l.code ? { code: l.code } : {}),
                description: l.description.trim(),
                quantity: num(l.qty),
                unit: l.unit || 'PCS',
                price: num(l.price),
                discount: num(l.discount),
            }));

        // Backend SO enum is uppercase (DRAFT | CONFIRMED | …). Shipping address,
        // delivery notes, additional costs and the tax breakdown have no columns
        // in the SO schema and are intentionally omitted (display-only).
        const payload = {
            customerId,
            customerName,
            issueDate: orderDate,
            ...(expectedDate ? { expiryDate: expectedDate } : {}),
            notes: reference ? `Ref: ${reference}` : (selectedSO?.notes || ''),
            status: status.toUpperCase(),
            items,
        };

        setSaving(true);
        try {
            if (isEdit && selectedSO) {
                await updateSO.mutateAsync({ id: selectedSO.id, ...payload });
                return selectedSO.id;
            }
            const created = await createSO.mutateAsync(payload) as { id: string };
            return created.id;
        } catch (err) {
            window.alert(`Failed to save sales order: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return null;
        } finally {
            setSaving(false);
        }
    };

    const finishSave = (id: string | null) => {
        if (!id) return;
        if (workspaceTabId) {
            clearDraft(workspaceTabId);
            closeTab(workspaceTabId);
        } else {
            navigate('/ar/sales-orders');
        }
    };

    const handleSaveDraft = async () => finishSave(await persist('Draft'));
    const handleConfirm = async () => finishSave(await persist('Confirmed'));
    const handleSaveAndInvoice = async () => {
        const id = await persist('Confirmed');
        if (!id) return;
        try {
            await convertSO.mutateAsync(id);
        } catch (err) {
            window.alert(`Saved, but couldn't convert to invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        finishSave(id);
    };

    // ── UI helpers ──────────────────────────────────────────────────────────
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
                                <div className="text-[11px] text-neutral-500">{firstStr(p.code, p.sku)} · Stock {formatNumber(num(p.currentStock ?? p.stock))}</div>
                            </div>
                            <div className="text-[13px] font-semibold text-success-600 tabular-nums">{formatIDR(num(p.price))}</div>
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
            {/* Header card */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-6">
                        <SearchableSelect
                            label={<>Customer <span className="text-danger-500">*</span></>}
                            options={customerOptions}
                            value={customerId}
                            onChange={handleCustomerChange}
                            placeholder="Search & select customer…"
                        />
                    </div>
                    <div className="col-span-3">
                        <label className={lbl}>SO Number</label>
                        <div className={`${ctl} flex items-center justify-between font-mono text-neutral-500`}>
                            {isEdit ? (selectedSO?.number || soId) : 'Auto'}
                            {!isEdit && <span className="text-[10px] text-neutral-400 font-sans">on save</span>}
                        </div>
                    </div>
                    <div className="col-span-3">
                        <label className={lbl}>Order Date <span className="text-danger-500">*</span></label>
                        <input type="date" className={ctl} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-neutral-200 px-1">
                <TabBtn id="items" label="Items" />
                <TabBtn id="costs" label="Additional costs" />
                <TabBtn id="info" label="Additional info" dot={refError && !reference.trim()} />
            </div>

            {activeTab === 'items' && (
                <LineItemsTable
                    lines={doc.lines}
                    showTax={tax.on}
                    onChange={doc.updateLine}
                    onRemove={doc.removeLine}
                    searchSlot={searchSlot}
                />
            )}

            {activeTab === 'costs' && (
                <AdditionalCostsTable
                    charges={doc.charges}
                    onChange={doc.updateCharge}
                    onRemove={doc.removeCharge}
                    onAdd={doc.addCharge}
                />
            )}

            {activeTab === 'info' && (
                <AdditionalInfoTab
                    party="customer"
                    tax={tax}
                    onTaxChange={(next) => setTax((t) => ({ ...t, ...next }))}
                    deliveryDate={expectedDate}
                    onDeliveryDateChange={setExpectedDate}
                    reference={reference}
                    onReferenceChange={(v) => { setReference(v); setRefError(false); }}
                    referenceError={refError}
                    isOrder
                    autoClose={autoClose}
                    onAutoCloseChange={setAutoClose}
                />
            )}

            {/* Logistics */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={lbl}>Shipping address</label>
                        <textarea className={`${ctl} h-[68px] py-2 resize-y leading-relaxed`} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} />
                    </div>
                    <div>
                        <label className={lbl}>Delivery / internal notes</label>
                        <textarea className={`${ctl} h-[68px] py-2 resize-y`} placeholder="Optional notes for warehouse / driver…" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} />
                    </div>
                </div>
            </div>
        </>
    );

    const rail = (
        <>
            <DocumentTotals totals={totals} taxRate={tax.on ? tax.rate : undefined} />
            <CustomerContextRail
                hasCustomer={!!customerId}
                customerName={firstStr(customer?.name) || 'Customer'}
                taxId={taxId}
                creditLimit={creditLimit || undefined}
                outstanding={outstanding}
                orderTotal={totals.grandTotal}
                recentDocs={recentDocs}
            />
        </>
    );

    return (
        <div className="p-0">
            <DocumentFormLayout
                title={isEdit ? `Edit Sales Order` : 'New Sales Order'}
                dirty={dirty}
                saving={saving}
                onBack={() => navigate('/ar/sales-orders')}
                backLabel="Sales Orders"
                printOptions={[
                    { label: 'Print / PDF', hint: 'Preview, print, or download', onClick: () => setIsPrintOpen(true) },
                ]}
                onSaveDraft={handleSaveDraft}
                primaryLabel="Save & confirm"
                primaryIcon={<CheckCircle2 size={13} />}
                onPrimary={handleConfirm}
                primaryOptions={[
                    { label: 'Save & confirm', hint: 'Lock the order', onClick: handleConfirm },
                    { label: 'Save & create invoice', hint: 'Convert to AR invoice', onClick: handleSaveAndInvoice },
                    { label: 'Save as draft', onClick: handleSaveDraft },
                ]}
                main={main}
                rail={rail}
            />
            <PrintPreviewModal
                isOpen={isPrintOpen}
                onClose={() => setIsPrintOpen(false)}
                title="Sales Order Print Preview"
                documentTitle={`SalesOrder_${selectedSO?.number || 'DRAFT'}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                <SalesOrderPrintTemplate
                    salesOrder={{
                        id: selectedSO?.number || 'DRAFT',
                        customerName: firstStr(customer?.name) || selectedSO?.customerName || '',
                        date: orderDate,
                        expectedDate,
                        status: selectedSO?.status || 'Draft',
                        notes: deliveryNotes,
                        amount: totals.grandTotal,
                    } as unknown as Record<string, unknown>}
                    lineItems={doc.lines as unknown as Record<string, unknown>[]}
                    company={company as unknown as Record<string, unknown>}
                    options={printSettings}
                />
            </PrintPreviewModal>
        </div>
    );
};

export default SOFormV2;
