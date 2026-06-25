import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Send, Search, Package } from 'lucide-react';

import DocumentFormLayout from '../../documents/DocumentFormLayout';
import LineItemsTable from '../../documents/LineItemsTable';
import AdditionalCostsTable from '../../documents/AdditionalCostsTable';
import AdditionalInfoTab, { type TaxState } from '../../documents/AdditionalInfoTab';
import DocumentTotals from '../../documents/DocumentTotals';
import CustomerContextRail, { type RecentDoc } from '../salesorders/CustomerContextRail';
import { useDocumentLines } from '../../documents/useDocumentLines';
import { computeTotals } from '../../documents/computeTotals';
import type { DocLine } from '../../documents/types';

import SearchableSelect from '../../UI/SearchableSelect';
import { formatIDR } from '../../../utils/formatters';
import { useCustomerStore } from '../../../stores/useCustomerStore';
import {
    useCustomers,
    useInvoices,
    useInvoice,
    useCreateInvoice,
    useUpdateInvoice,
} from '../../../hooks/useAR';
import { useItems } from '../../../hooks/useInventory';
import { useAccountsByType } from '../../../hooks/useGL';

/**
 * InvoiceFormV2 — Sales Invoice on the shared document-form system.
 *
 * A thin host, exactly like SOFormV2: it owns header fields + data wiring + save,
 * and delegates the line table / additional costs / totals math / layout / action
 * bar to /components/documents. Same look & feel as the Sales Order form.
 *
 * Differences from SOFormV2 (things invoices need that orders don't):
 *  - Due date with auto-fill from the customer's payment terms
 *  - "Save & send" posts the invoice (DRAFT -> SENT) instead of confirming an order
 *  - PO reference maps to the invoice's poNumber
 *  - Optional document-level discount %
 *
 * Additional costs ARE persisted + journaled: each charge codes to its own
 * (income) account via SalesInvoiceCharge; calculateInvoiceTotals folds them into
 * the invoice total/tax, and postInvoiceSend credits each charge account on SEND
 * instead of inflating sales revenue.
 */

const TAX_RATE = 11; // PPN
const todayString = (): string => new Date().toISOString().slice(0, 10);

type Rec = { id: string } & Record<string, unknown>;

const str = (v: unknown): string => String(v ?? '').trim();
const firstStr = (...vals: unknown[]): string => vals.map(str).find(Boolean) || '';
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Build a billing/shipping address from a customer record. */
const buildAddress = (c: Rec | undefined): string => {
    if (!c) return '';
    const direct = firstStr(c.shippingAddress, c.billingAddress);
    if (direct) return direct;
    return [c.address1, c.city, c.province].map(str).filter(Boolean).join(', ');
};

/** Add days to a YYYY-MM-DD date string. */
const addDays = (iso: string, days: number): string => {
    if (!iso || !days) return iso;
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};

/** Open AR statuses that count toward a customer's outstanding balance. */
const OPEN_STATUSES = new Set(['unpaid', 'overdue', 'partial', 'sent', 'pending']);

interface InvoiceFormV2Props {
    mode?: 'create' | 'edit';
}

const InvoiceFormV2: React.FC<InvoiceFormV2Props> = ({ mode = 'create' }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const locState = (location.state || {}) as { openInvoiceId?: string; returnToWorkbench?: boolean };
    const invoiceId = searchParams.get('invoiceId') || locState.openInvoiceId || '';
    const isEdit = mode === 'edit' || !!invoiceId;

    // ── Stores & server data ────────────────────────────────────────────────
    const seedCustomers = (useCustomerStore((s) => s.customers) as Rec[]) || [];
    const { data: customersResult } = useCustomers({ limit: 100 });
    const { data: itemsResult } = useItems({ limit: 100 });
    const { data: invoicesResult } = useInvoices({ limit: 100 });
    const { data: editingInvoice } = useInvoice(isEdit ? invoiceId : undefined);

    const createInvoice = useCreateInvoice();
    const updateInvoice = useUpdateInvoice();

    // Sales-side charges are income/recovery → code them to a Revenue account.
    const { data: revenueAccountsData } = useAccountsByType('Revenue');
    const accountOptions = useMemo(
        () => (revenueAccountsData ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
        [revenueAccountsData],
    );

    const customers = useMemo<Rec[]>(() => {
        const byId = new Map<string, Rec>();
        [...seedCustomers, ...((customersResult?.data as unknown as Rec[]) || [])].forEach((c) => {
            if (c?.id) byId.set(c.id, { ...(byId.get(c.id) || {}), ...c });
        });
        return [...byId.values()];
    }, [seedCustomers, customersResult?.data]);

    const inventoryItems = useMemo<Rec[]>(
        () => ((itemsResult?.data as unknown as Rec[]) || []),
        [itemsResult?.data],
    );
    const invoices = useMemo<Rec[]>(
        () => ((invoicesResult?.data as unknown as Rec[]) || []),
        [invoicesResult?.data],
    );

    // ── Header state ────────────────────────────────────────────────────────
    const [customerId, setCustomerId] = useState('');
    const [issueDate, setIssueDate] = useState(todayString());
    const [dueDate, setDueDate] = useState('');
    const [poNumber, setPoNumber] = useState('');
    const [shippingAddress, setShippingAddress] = useState('');
    const [notes, setNotes] = useState('');
    const [docDiscountPct, setDocDiscountPct] = useState(0);
    const [tax, setTax] = useState<TaxState>({ on: false, rate: TAX_RATE, mode: 'exclusive' });

    // ── Lines + charges (shared hook) ───────────────────────────────────────
    const seedLines = useMemo<DocLine[]>(() => {
        const src = (editingInvoice?.lines || editingInvoice?.items || []) as Rec[];
        return src.map((l, i) => ({
            id: str(l.id) || `li-${i}`,
            productId: firstStr(l.itemId, l.productId),
            code: firstStr(l.code),
            description: firstStr(l.description, l.itemName),
            qty: num(l.quantity),
            unit: str(l.unit) || 'PCS',
            price: num(l.price),
            discount: num(l.discountPct ?? l.discount),
            taxRate: TAX_RATE,
        }));
    }, [editingInvoice]);

    const seedCharges = useMemo(() => {
        const src = editingInvoice?.charges || [];
        return src.map((c, i) => ({
            id: str(c.id) || `ch-${i}`,
            label: firstStr(c.label),
            accountId: firstStr(c.accountId),
            accountLabel: '',
            amount: num(c.amount),
            taxRate: num(c.taxRate),
        }));
    }, [editingInvoice]);

    const doc = useDocumentLines(seedLines, seedCharges);
    const { setLines, setCharges } = doc;

    // Seed header + lines once the edited invoice arrives.
    useEffect(() => {
        if (!editingInvoice) return;
        setCustomerId(str(editingInvoice.customerId));
        setIssueDate(str(editingInvoice.issueDate) || todayString());
        setDueDate(str(editingInvoice.dueDate));
        setPoNumber(str(editingInvoice.poNumber));
        setShippingAddress(str(editingInvoice.shippingAddress) || str(editingInvoice.billingAddress));
        setNotes(str(editingInvoice.notes));
        setDocDiscountPct(num(editingInvoice.discountPct));
        if (typeof editingInvoice.taxAmount === 'number') {
            setTax((t) => ({ ...t, on: num(editingInvoice.taxAmount) > 0 }));
        }
        setLines(seedLines);
        setCharges(seedCharges);
    }, [editingInvoice, seedLines, seedCharges, setLines, setCharges]);

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
    const subtotalForDisc = useMemo(
        () => doc.lines.reduce((s, l) => {
            const gross = num(l.qty) * num(l.price);
            return s + (gross - gross * (num(l.discount) / 100));
        }, 0),
        [doc.lines],
    );
    const documentDiscount = Math.round(subtotalForDisc * (num(docDiscountPct) / 100));

    const totals = useMemo(
        () => computeTotals(doc.lines, doc.charges, {
            taxOn: tax.on, taxRate: tax.rate, taxMode: tax.mode, documentDiscount,
        }),
        [doc.lines, doc.charges, tax, documentDiscount],
    );

    // ── Customer context ────────────────────────────────────────────────────
    const customer = useMemo(() => customers.find((c) => c.id === customerId), [customers, customerId]);
    const creditLimit = customer ? num(customer.creditLimit ?? customer.credit_limit) : 0;
    const taxId = customer ? firstStr(customer.npwp, customer.taxId, customer.tax_id) : '';
    const paymentTerms = customer ? num(customer.paymentTerms ?? customer.paymentTermsDays) : 0;

    const customerInvoices = useMemo(
        () => invoices.filter((inv) => str(inv.customerId) === customerId && str(inv.id) !== invoiceId),
        [invoices, customerId, invoiceId],
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
        if (c) {
            if (!shippingAddress.trim()) setShippingAddress(buildAddress(c));
            const terms = num(c.paymentTerms ?? c.paymentTermsDays);
            if (!dueDate && terms > 0 && issueDate) setDueDate(addDays(issueDate, terms));
        }
    };

    const dirty = doc.dirty || !!customerId || !!poNumber || !!notes || docDiscountPct > 0;

    // ── Save ────────────────────────────────────────────────────────────────
    const validate = (): boolean => {
        if (!customerId) { setActiveTab('items'); window.alert('Select a customer first.'); return false; }
        if (!issueDate) { setActiveTab('items'); window.alert('Invoice date is required.'); return false; }
        if (doc.lines.filter((l) => l.description.trim()).length === 0) {
            setActiveTab('items'); window.alert('Add at least one line item.'); return false;
        }
        return true;
    };

    const cleanedLines = () =>
        doc.lines
            .filter((l) => l.description.trim())
            .map((l, idx) => ({
                lineNo: idx + 1,
                itemId: l.productId || null,
                code: l.code || undefined,
                description: l.description.trim(),
                quantity: num(l.qty),
                unit: l.unit || 'PCS',
                price: num(l.price),
                discountPct: num(l.discount),
                lineSubtotal:
                    Math.round(num(l.qty) * num(l.price) * (1 - num(l.discount) / 100) * 100) / 100,
            }));

    const cleanedCharges = () =>
        doc.charges
            .filter((c) => c.label.trim() && num(c.amount) !== 0)
            .map((c, idx) => ({
                lineNo: idx + 1,
                label: c.label.trim(),
                ...(c.accountId && { accountId: c.accountId }),
                amount: num(c.amount),
                taxRate: num(c.taxRate),
            }));

    const persist = async (saveAsDraft: boolean): Promise<boolean> => {
        if (!validate()) return false;
        setSaving(true);
        try {
            if (isEdit && invoiceId) {
                await updateInvoice.mutateAsync({
                    id: invoiceId,
                    customerId,
                    invoiceType: str(editingInvoice?.invoiceType) || 'Sales Invoice',
                    issueDate: new Date(issueDate).toISOString(),
                    dueDate: dueDate ? new Date(dueDate).toISOString() : null,
                    poNumber: poNumber || null,
                    billingAddress: shippingAddress || null,
                    shippingAddress: shippingAddress || null,
                    notes: notes || null,
                    taxEnabled: tax.on,
                    taxInclusive: tax.mode === 'inclusive',
                    taxRate: tax.rate,
                    subtotal: totals.subtotal,
                    discountPct: num(docDiscountPct),
                    discountAmount: totals.documentDiscount,
                    taxAmount: totals.tax,
                    totalAmount: totals.grandTotal,
                    lines: cleanedLines(),
                    charges: cleanedCharges(),
                    ...(saveAsDraft ? {} : { status: 'Sent' }),
                } as { id: string } & Record<string, unknown>);
            } else {
                const created = await createInvoice.mutateAsync({
                    customerId,
                    invoiceType: 'Sales Invoice',
                    issueDate,
                    ...(dueDate && { dueDate }),
                    ...(poNumber && { poNumber }),
                    ...(shippingAddress && { billingAddress: shippingAddress, shippingAddress }),
                    currency: 'IDR',
                    discountPct: num(docDiscountPct),
                    tax: { enabled: tax.on, inclusive: tax.mode === 'inclusive', rate: tax.rate },
                    ...(notes && { notes }),
                    lines: cleanedLines().map(({ lineNo, lineSubtotal, ...rest }) => rest),
                    ...(cleanedCharges().length > 0 && { charges: cleanedCharges() }),
                }) as { id: string; number: string };

                // "Save & send" posts the draft to GL via a status transition.
                if (!saveAsDraft && created?.id) {
                    await updateInvoice.mutateAsync({ id: created.id, status: 'Sent' });
                }
            }
            return true;
        } catch (err) {
            window.alert(`Failed to save invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return false;
        } finally {
            setSaving(false);
        }
    };

    const goBack = () => navigate('/ar/invoices');
    const handleSaveDraft = async () => { if (await persist(true)) goBack(); };
    const handleSaveSend = async () => { if (await persist(false)) goBack(); };

    // ── UI helpers ──────────────────────────────────────────────────────────
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

    const isPosted = isEdit && !!editingInvoice && !['DRAFT', 'PENDING_APPROVAL', ''].includes(str(editingInvoice.status).toUpperCase());

    const main = (
        <>
            {isPosted && (
                <div className="bg-warning-50 border border-warning-200 rounded-lg px-4 py-2.5 text-[12px] text-warning-800">
                    This invoice is already posted. Saving your changes will <strong>reverse and re-post</strong> its journal entry (only while the period is open). Invoices with receipts, returns, or inventory items must be voided to change.
                </div>
            )}
            {/* Header card */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4">
                        <SearchableSelect
                            label={<>Customer <span className="text-danger-500">*</span></>}
                            options={customerOptions}
                            value={customerId}
                            onChange={handleCustomerChange}
                            placeholder="Search & select customer…"
                        />
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Invoice #</label>
                        <div className={`${ctl} flex items-center justify-between font-mono text-neutral-500`}>
                            {isEdit ? firstStr(editingInvoice?.number, invoiceId) : 'Auto'}
                            {!isEdit && <span className="text-[10px] text-neutral-400 font-sans">on save</span>}
                        </div>
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Invoice type</label>
                        <div className={`${ctl} flex items-center text-neutral-700`}>Sales Invoice</div>
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Issue date <span className="text-danger-500">*</span></label>
                        <input type="date" className={ctl} value={issueDate}
                            onChange={(e) => {
                                setIssueDate(e.target.value);
                                if (paymentTerms > 0) setDueDate(addDays(e.target.value, paymentTerms));
                            }} />
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Due date</label>
                        <input type="date" className={ctl} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                        {paymentTerms > 0 && <div className="text-[11px] text-neutral-400 mt-1">Net {paymentTerms} from issue</div>}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-neutral-200 px-1">
                <TabBtn id="items" label="Items" />
                <TabBtn id="costs" label="Additional costs" />
                <TabBtn id="info" label="Additional info" />
            </div>

            {activeTab === 'items' && (
                <LineItemsTable
                    lines={doc.lines}
                    showTax={tax.on}
                    onChange={doc.updateLine}
                    onRemove={doc.removeLine}
                    onAddLine={doc.addLine}
                    searchSlot={searchSlot}
                />
            )}

            {activeTab === 'costs' && (
                <AdditionalCostsTable
                    charges={doc.charges}
                    onChange={doc.updateCharge}
                    onRemove={doc.removeCharge}
                    onAdd={doc.addCharge}
                    accountOptions={accountOptions}
                />
            )}

            {activeTab === 'info' && (
                <AdditionalInfoTab
                    party="customer"
                    tax={tax}
                    onTaxChange={(next) => setTax((t) => ({ ...t, ...next }))}
                    deliveryDate={dueDate}
                    onDeliveryDateChange={setDueDate}
                    reference={poNumber}
                    onReferenceChange={setPoNumber}
                />
            )}

            {/* Logistics + document discount */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-5">
                        <label className={lbl}>Shipping / billing address</label>
                        <textarea className={`${ctl} h-[68px] py-2 resize-y leading-relaxed`} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} />
                    </div>
                    <div className="col-span-5">
                        <label className={lbl}>Notes</label>
                        <textarea className={`${ctl} h-[68px] py-2 resize-y`} placeholder="Optional notes shown on the invoice…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Document discount %</label>
                        <input type="number" min={0} max={100} className={`${ctl} text-right tabular-nums`} value={docDiscountPct} onChange={(e) => setDocDiscountPct(num(e.target.value))} />
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
        <div className="p-4 lg:p-6">
            <DocumentFormLayout
                title={isEdit ? 'Edit Invoice' : 'New Invoice'}
                dirty={dirty}
                saving={saving}
                onBack={goBack}
                backLabel="Invoices"
                printOptions={[
                    { label: 'Print A4', hint: 'Standard paper', onClick: () => window.print() },
                    { label: 'Print A5', hint: 'Half-page', onClick: () => window.print() },
                    { label: 'Email PDF', onClick: () => {} },
                ]}
                onSaveDraft={handleSaveDraft}
                primaryLabel="Save & send"
                primaryIcon={<Send size={13} />}
                onPrimary={handleSaveSend}
                primaryOptions={[
                    { label: 'Save & send', hint: 'Post the invoice and mark it sent', onClick: handleSaveSend },
                    { label: 'Save as draft', hint: 'Keep editable, nothing posts yet', onClick: handleSaveDraft },
                ]}
                main={main}
                rail={rail}
            />
        </div>
    );
};

export default InvoiceFormV2;
