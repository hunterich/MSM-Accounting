import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle2, Search, Package, X, FileText, Paperclip, AlertTriangle } from 'lucide-react';

import DocumentFormLayout from '../../components/documents/DocumentFormLayout';
import LineItemsTable from '../../components/documents/LineItemsTable';
import DocumentTotals from '../../components/documents/DocumentTotals';
import SettlementCard from '../../components/documents/SettlementCard';
import CustomerContextRail, { type RecentDoc } from '../../components/ar/salesorders/CustomerContextRail';
import { useDocumentLines } from '../../components/documents/useDocumentLines';
import { computeTotals, lineNet } from '../../components/documents/computeTotals';
import type { DocLine } from '../../components/documents/types';

import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { formatIDR } from '../../utils/formatters';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useExtraAction } from '../../hooks/useModulePermissions';
import {
    useCustomers, useCreateCustomer, useInvoices, useCreateInvoice, useUpdateInvoice,
    useDeleteInvoice, useARPayments, useSendInvoiceEmail,
} from '../../hooks/useAR';
import { useCreditNotes } from '../../hooks/useReturns';
import { useItems } from '../../hooks/useInventory';

/**
 * InvoiceFormV2 — AR Sales Invoice on the shared document-form system.
 *
 * Migrated from the 1040-line InvoiceForm at exact backend parity: the POST/PUT
 * payloads, numbering, tax (enabled/inclusive/rate), header discount, sales-policy
 * save gates, per-line price-override lock, quick-create customer, attachments,
 * and the two-call approve flow (POST draft → PUT status:Sent) are all preserved
 * so GL posting / credit-limit enforcement behave identically.
 *
 * Adds the posted lifecycle: a posted invoice renders read-only with a
 * SettlementCard (payments received / returns / outstanding) in the rail.
 *
 * Deferred (own backend PR): additional costs — there is no charge model in the
 * schema, so charges aren't offered here (would mis-post to sales revenue).
 */

type Rec = { id: string } & Record<string, unknown>;
const str = (v: unknown): string => String(v ?? '').trim();
const firstStr = (...vals: unknown[]): string => vals.map(str).find(Boolean) || '';
const num = (v: unknown): number => Number(v ?? 0) || 0;
const todayString = (): string => new Date().toISOString().split('T')[0];

interface EditorState {
    openInvoiceId?: string;
    mode?: string;
    returnToWorkbench?: boolean;
    catalogState?: { searchTerm?: string; status?: string; dateFrom?: string; dateTo?: string };
}

const OPEN_AR_STATUSES = new Set(['unpaid', 'overdue', 'partial', 'sent', 'pending']);

const InvoiceFormV2: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation() as { state?: EditorState };

    // ── Server data ─────────────────────────────────────────────────────────
    const { data: customersData } = useCustomers();
    const customerList = ((customersData?.data || []) as unknown as Rec[]);
    const { data: invoicesData } = useInvoices();
    const invoices = ((invoicesData?.data || []).filter(Boolean) as unknown as Rec[]);
    const { data: itemsData } = useItems();
    const products = ((itemsData?.data || []) as unknown as Rec[]);
    const { data: paymentsData } = useARPayments();
    const payments = ((paymentsData?.data || []) as unknown as Rec[]);
    const { data: creditNotesData } = useCreditNotes();
    const creditNotes = ((creditNotesData?.data || []) as unknown as Rec[]);

    const createInvoice = useCreateInvoice();
    const updateInvoice = useUpdateInvoice();
    const deleteInvoice = useDeleteInvoice();
    const createCustomer = useCreateCustomer();
    const sendEmail = useSendInvoiceEmail();

    // ── Settings / policy ─────────────────────────────────────────────────────
    const globalTax = useSettingsStore((s) => s.taxSettings);
    const docNumbering = useSettingsStore((s) => s.documentNumbering?.ar_invoice ?? { prefix: 'INV', resetPeriod: 'monthly', seqLength: 6 });
    const salesPolicy = useSettingsStore((s) => s.salesPolicy);
    const canBypassBelowCost = useExtraAction('ar_invoices', 'sellBelowCost');
    const canBypassRequireSO = useExtraAction('ar_invoices', 'invoiceWithoutSO');
    const canOverridePrice = useExtraAction('ar_invoices', 'overridePrice');

    // ── Editing target ──────────────────────────────────────────────────────
    const [editingId, setEditingId] = useState<string | null>(null);
    const existing = useMemo(() => invoices.find((inv) => inv.id === editingId) || null, [invoices, editingId]);
    const status = existing ? str(existing.status) : 'Draft';
    const isEdit = !!editingId;
    const locked = isEdit && status !== 'Draft'; // posted: read-only

    // ── Header state ──────────────────────────────────────────────────────────
    const [customerId, setCustomerId] = useState('');
    const [email, setEmail] = useState('');
    const [billingAddress, setBillingAddress] = useState('');
    const [shippingAddress, setShippingAddress] = useState('');
    const [poNumber, setPoNumber] = useState('');
    const [issueDate, setIssueDate] = useState(todayString());
    const [dueDate, setDueDate] = useState('');
    const [shippingDate, setShippingDate] = useState(todayString());
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [numberingMode, setNumberingMode] = useState<'auto' | 'manual'>('auto');
    const [discountPct, setDiscountPct] = useState(0);
    const [notes, setNotes] = useState('');
    const [customerTerms, setCustomerTerms] = useState<number | null>(null);
    const [tax, setTax] = useState({ enabled: globalTax.enabled, inclusive: globalTax.inclusiveByDefault, rate: globalTax.defaultRate });
    const [attachments, setAttachments] = useState<{ id: string | number; name: string; size: string }[]>([]);
    const [activeTab, setActiveTab] = useState<'items' | 'info' | 'attachments'>('items');

    // ── Lines ─────────────────────────────────────────────────────────────────
    const doc = useDocumentLines([], []);
    const { setLines } = doc;

    // ── Load an existing invoice (edit/view) once invoices resolve ────────────
    const seedLines = useMemo<DocLine[]>(() => {
        const items = (existing?.items || existing?.lines || []) as Record<string, unknown>[];
        return items.map((l, i) => ({
            id: str(l.id) || `li-${i}`,
            productId: firstStr(l.itemId, l.productId),
            code: firstStr(l.code),
            description: firstStr(l.description, l.itemName),
            qty: num(l.quantity ?? l.qty),
            unit: firstStr(l.unit) || 'PCS',
            price: num(l.price),
            discount: num(l.discountPct ?? l.discount),
            taxRate: tax.enabled ? tax.rate : 0,
        }));
    }, [existing, tax.enabled, tax.rate]);

    useEffect(() => {
        const st = location.state || {};
        if (st.openInvoiceId && st.mode === 'edit' && invoices.length > 0) {
            const found = invoices.find((inv) => inv.id === st.openInvoiceId);
            if (found && found.id !== editingId) {
                setEditingId(found.id);
                setNumberingMode('manual');
                setCustomerId(firstStr(found.customerId));
                setIssueDate(firstStr(found.issueDate) || todayString());
                setDueDate(firstStr(found.dueDate));
                setInvoiceNumber(firstStr(found.number));
                setNotes(firstStr(found.notes));
                setPoNumber(firstStr(found.poNumber));
                setBillingAddress(firstStr(found.billingAddress));
                setShippingAddress(firstStr(found.shippingAddress));
                setDiscountPct(num(found.discountPct));
                setTax({
                    enabled: found.taxEnabled !== false,
                    inclusive: found.taxInclusive === true,
                    rate: num(found.taxRate) || globalTax.defaultRate,
                });
                setActiveTab('items');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state, invoices.length]);

    useEffect(() => { setLines(seedLines); }, [seedLines, setLines]);

    // ── Numbering ─────────────────────────────────────────────────────────────
    const nextSequence = useMemo(() => {
        const max = Math.max(0, ...invoices.map((inv) => {
            const m = str(inv.number).match(/(\d{3,})$/);
            return m ? parseInt(m[1], 10) : 0;
        }));
        return max + 1;
    }, [invoices]);

    const autoNumberPreview = useMemo(() => {
        const d = issueDate ? new Date(issueDate) : new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${docNumbering.prefix}/${yyyy}/${mm}/${String(nextSequence).padStart(docNumbering.seqLength, '0')}`;
    }, [issueDate, nextSequence, docNumbering]);

    // ── Customer ───────────────────────────────────────────────────────────────
    const customer = useMemo(() => customerList.find((c) => c.id === customerId), [customerList, customerId]);
    const customerOptions = useMemo(
        () => customerList.map((c) => ({ value: c.id, label: firstStr(c.name, c.code), subLabel: firstStr(c.code, c.email) })),
        [customerList],
    );

    const handleCustomerChange = (id: string) => {
        setCustomerId(id);
        const c = customerList.find((x) => x.id === id);
        if (c) {
            setEmail(firstStr(c.email));
            setBillingAddress(firstStr(c.billingAddress));
            setShippingAddress(firstStr(c.shippingAddress));
            setDiscountPct(num(c.defaultDiscount));
            const terms = num(c.paymentTerms);
            const d = new Date(issueDate);
            d.setDate(d.getDate() + (terms || 30));
            setDueDate(d.toISOString().split('T')[0]);
            setCustomerTerms(Number.isFinite(c.paymentTerms as number) ? terms : null);
        }
    };

    // quick-create customer
    const [showNewCustomer, setShowNewCustomer] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerError, setNewCustomerError] = useState('');
    const handleQuickCreate = async () => {
        const trimmed = newCustomerName.trim();
        if (!trimmed) { setNewCustomerError('Name is required.'); return; }
        try {
            const created = await createCustomer.mutateAsync({ name: trimmed, code: trimmed.replace(/\s+/g, '-').toUpperCase().slice(0, 10) }) as { id: string };
            setCustomerId(created.id);
            setShowNewCustomer(false); setNewCustomerName(''); setNewCustomerError('');
        } catch (e) {
            setNewCustomerError(e instanceof Error ? e.message : 'Failed to create customer.');
        }
    };

    // ── Product search-to-add ───────────────────────────────────────────────
    const [itemSearch, setItemSearch] = useState('');
    const [showResults, setShowResults] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    const filteredProducts = useMemo<Rec[]>(() => {
        const term = itemSearch.trim().toLowerCase();
        if (!term) return [];
        return products.filter((p) =>
            str(p.name).toLowerCase().includes(term) ||
            str(p.code).toLowerCase().includes(term) ||
            str(p.sku).toLowerCase().includes(term) ||
            str(p.id).toLowerCase().includes(term)).slice(0, 8);
    }, [itemSearch, products]);

    const addProduct = (p: Rec) => {
        doc.addLine({
            productId: str(p.id), code: firstStr(p.code, p.sku, p.id), description: firstStr(p.name, p.description),
            qty: 1, unit: firstStr(p.sellUnit, p.unit) || 'PCS', price: num(p.price), discount: 0,
            taxRate: tax.enabled ? tax.rate : 0, stock: num(p.currentStock ?? p.stock),
        });
        setItemSearch(''); setShowResults(false);
    };
    const addCustom = () => {
        if (!itemSearch.trim()) return;
        doc.addLine({ code: 'CUSTOM', description: itemSearch.trim(), taxRate: tax.enabled ? tax.rate : 0 });
        setItemSearch(''); setShowResults(false);
    };

    // ── Totals (header discount % → absolute documentDiscount) ────────────────
    const subtotalRaw = useMemo(() => doc.lines.reduce((s, l) => s + lineNet(l), 0), [doc.lines]);
    const discountAmount = useMemo(() => Math.round(subtotalRaw * (discountPct / 100) * 100) / 100, [subtotalRaw, discountPct]);
    const totals = useMemo(
        () => computeTotals(doc.lines, [], {
            documentDiscount: discountAmount,
            taxOn: tax.enabled, taxRate: tax.rate, taxMode: tax.inclusive ? 'inclusive' : 'exclusive',
        }),
        [doc.lines, discountAmount, tax],
    );

    // ── Settlement (posted) ─────────────────────────────────────────────────
    const paidAmount = useMemo(
        () => payments.filter((p) => str(p.invoiceId) === editingId && str(p.status).toLowerCase() !== 'void')
            .reduce((s, p) => s + num(p.amount ?? p.totalAmount), 0),
        [payments, editingId],
    );
    const returnsAmount = useMemo(
        () => creditNotes.filter((cn) => firstStr(cn.sourceInvoiceId, cn.invoiceId) === editingId)
            .reduce((s, cn) => s + num(cn.amount ?? cn.totalAmount), 0),
        [creditNotes, editingId],
    );
    const invoiceTotal = locked ? num(existing?.totalAmount ?? existing?.amount) || totals.grandTotal : totals.grandTotal;

    // ── Customer context rail data ────────────────────────────────────────────
    const customerInvoices = useMemo(() => invoices.filter((inv) => str(inv.customerId) === customerId && inv.id !== editingId), [invoices, customerId, editingId]);
    const outstanding = useMemo(
        () => customerInvoices.filter((inv) => OPEN_AR_STATUSES.has(str(inv.status).toLowerCase())).reduce((s, inv) => s + num(inv.amount ?? inv.totalAmount), 0),
        [customerInvoices],
    );
    const recentDocs = useMemo<RecentDoc[]>(
        () => customerInvoices.slice(0, 3).map((inv) => ({ id: firstStr(inv.number, inv.id), status: str(inv.status).toLowerCase() || 'draft' })),
        [customerInvoices],
    );

    // ── Save ───────────────────────────────────────────────────────────────
    const [saving, setSaving] = useState(false);

    const persist = async (saveAsDraft: boolean) => {
        // sales-policy gates apply only when approving (drafts can be parked)
        if (!saveAsDraft) {
            if (salesPolicy.requireSalesOrder && !canBypassRequireSO) {
                window.alert('A Sales Order is required before approving an invoice. Ask an administrator for the "Invoice Without Sales Order" override.');
                return;
            }
            if (salesPolicy.blockSellBelowCost && !canBypassBelowCost) {
                const violator = doc.lines.find((l) => {
                    const p = products.find((pr) => str(pr.id) === str(l.productId));
                    const cost = num(p?.cost);
                    return cost > 0 && l.price > 0 && l.price < cost;
                });
                if (violator) { window.alert(`Line "${violator.description}" is priced below cost. Adjust it or get the "Sell Below Cost" override.`); return; }
            }
        }

        const cleaned = doc.lines.filter((l) => str(l.description));
        if (!customerId) { window.alert('Select a customer first.'); return; }
        if (!issueDate) { window.alert('Invoice date is required.'); return; }
        if (cleaned.length === 0) { window.alert('Add at least one line item.'); return; }
        if (isEdit && status !== 'Draft') { window.alert('Only Draft invoices can be edited.'); return; }

        let savedId = editingId || '';
        let savedNumber = invoiceNumber;
        setSaving(true);
        try {
            if (isEdit && editingId) {
                await updateInvoice.mutateAsync({
                    id: editingId,
                    customerId,
                    invoiceType: 'Sales Invoice',
                    issueDate: new Date(issueDate).toISOString(),
                    dueDate: dueDate ? new Date(dueDate).toISOString() : null,
                    shippingDate: shippingDate ? new Date(shippingDate).toISOString() : null,
                    poNumber: poNumber || null,
                    billingAddress: billingAddress || null,
                    shippingAddress: shippingAddress || null,
                    notes: notes || null,
                    taxEnabled: tax.enabled,
                    taxInclusive: tax.inclusive,
                    taxRate: tax.rate,
                    subtotal: subtotalRaw,
                    discountPct: num(discountPct),
                    discountAmount,
                    taxAmount: totals.tax,
                    totalAmount: totals.grandTotal,
                    lines: cleaned.map((l, idx) => ({
                        lineNo: idx + 1,
                        itemId: l.productId || null,
                        description: l.description,
                        quantity: num(l.qty),
                        unit: l.unit || 'PCS',
                        price: num(l.price),
                        discountPct: num(l.discount),
                        lineSubtotal: Math.round(num(l.qty) * num(l.price) * (1 - num(l.discount) / 100) * 100) / 100,
                    })),
                    ...(saveAsDraft ? {} : { status: 'Sent' }),
                } as Parameters<typeof updateInvoice.mutateAsync>[0]);
            } else {
                const created = await createInvoice.mutateAsync({
                    customerId,
                    invoiceType: 'Sales Invoice',
                    issueDate,
                    ...(dueDate && { dueDate }),
                    ...(shippingDate && { shippingDate }),
                    ...(poNumber && { poNumber }),
                    ...(billingAddress && { billingAddress }),
                    ...(shippingAddress && { shippingAddress }),
                    currency: 'IDR',
                    discountPct: num(discountPct),
                    tax: { enabled: tax.enabled, inclusive: tax.inclusive, rate: tax.rate },
                    ...(notes && { notes }),
                    lines: cleaned.map((l) => ({
                        ...(l.productId && { itemId: l.productId }),
                        ...(l.code && { code: l.code }),
                        description: l.description,
                        quantity: num(l.qty),
                        unit: l.unit || 'PCS',
                        price: num(l.price),
                        discountPct: num(l.discount),
                    })),
                } as Parameters<typeof createInvoice.mutateAsync>[0]) as { id: string; number: string };
                savedId = created.id;
                savedNumber = created.number;
                if (!saveAsDraft) {
                    await updateInvoice.mutateAsync({ id: created.id, status: 'Sent' } as Parameters<typeof updateInvoice.mutateAsync>[0]);
                }
            }
        } catch (err) {
            window.alert(`Failed to save invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setSaving(false);
            return;
        }
        setSaving(false);
        navigateBack(savedId, savedNumber);
    };

    const navigateBack = (savedId?: string, savedNumber?: string) => {
        if (location.state?.returnToWorkbench) {
            const cat = location.state?.catalogState || {};
            const q = new URLSearchParams();
            if (cat.searchTerm) q.set('search', cat.searchTerm);
            if (cat.status) q.set('status', cat.status);
            if (cat.dateFrom) q.set('from', cat.dateFrom);
            if (cat.dateTo) q.set('to', cat.dateTo);
            const target = location.state?.openInvoiceId || savedId;
            if (target) q.set('invoiceId', target);
            navigate(`/ar/invoices/workbench?${q.toString()}`, { state: { invoiceId: target, catalogState: cat, updatedNumber: savedNumber } });
            return;
        }
        navigate('/ar/invoices');
    };

    const handleDelete = async () => {
        if (!editingId) return;
        try { await deleteInvoice.mutateAsync(editingId); navigateBack(); }
        catch (e) { window.alert(`Failed to delete: ${e instanceof Error ? e.message : 'error'}`); }
    };

    const handleEmail = async () => {
        if (!editingId) return;
        const to = email || firstStr(customer?.email);
        if (!to) { window.alert('No email on file for this customer.'); return; }
        try { await sendEmail.mutateAsync({ invoiceId: editingId, to }); window.alert(`Invoice emailed to ${to}.`); }
        catch (e) { window.alert(`Failed to send: ${e instanceof Error ? e.message : 'error'}`); }
    };

    // ── UI helpers ──────────────────────────────────────────────────────────
    const lbl = 'block mb-1 text-[12px] font-medium text-neutral-700';
    const ctl = 'w-full h-9 px-2.5 text-[13px] text-neutral-900 bg-white border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-100 disabled:text-neutral-500';

    const TabBtn = ({ id, label }: { id: typeof activeTab; label: string }) => (
        <button type="button" onClick={() => setActiveTab(id)}
            className={`inline-flex items-center gap-1.5 py-2 px-3.5 text-[13px] font-semibold border-b-2 transition-colors ${activeTab === id ? 'text-primary-700 border-primary-600' : 'text-neutral-600 border-transparent hover:text-neutral-900'}`}>
            {label}
        </button>
    );

    const searchSlot = (
        <div className="relative w-80" ref={searchRef}>
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={itemSearch} onChange={(e) => { setItemSearch(e.target.value); setShowResults(true); }} onFocus={() => setShowResults(true)}
                placeholder="Search items or add custom line…" className="w-full h-8 pl-8 pr-3 rounded-md border border-neutral-300 bg-white text-[13px] focus:border-primary-500 focus:outline-none" />
            {showResults && itemSearch.trim() && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-[280px] overflow-y-auto z-50">
                    {filteredProducts.length > 0 ? filteredProducts.map((p) => (
                        <div key={p.id} onClick={() => addProduct(p)} className="px-3 py-2 flex justify-between items-center cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                            <div className="min-w-0">
                                <div className="text-[13px] font-medium text-neutral-900 truncate">{firstStr(p.name, p.description)}</div>
                                <div className="text-[11px] text-neutral-500">{firstStr(p.code, p.sku)} · Stock {num(p.currentStock ?? p.stock).toLocaleString()}</div>
                            </div>
                            <div className="text-[13px] font-semibold text-success-600 tabular-nums">{formatIDR(num(p.price))}</div>
                        </div>
                    )) : (
                        <div onClick={addCustom} className="px-3 py-2.5 text-center text-[13px] text-primary-700 cursor-pointer hover:bg-primary-50">
                            <Package size={14} className="inline mr-1.5" />Add “{itemSearch.trim()}” as a custom line
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    // low-stock warning banner under the line table
    const stockWarnings = doc.lines.filter((l) => {
        if (!l.productId) return false;
        const p = products.find((pr) => str(pr.id) === str(l.productId));
        const avail = num(p?.currentStock ?? p?.stock);
        return p && l.qty > avail;
    });

    const main = (
        <>
            {/* Header card */}
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4">
                        <SearchableSelect
                            label={<>Customer <span className="text-danger-500">*</span></>}
                            options={customerOptions}
                            value={customerId}
                            onChange={(v) => { handleCustomerChange(v); setShowNewCustomer(false); }}
                            placeholder="Search & select customer…"
                            disabled={locked}
                            footerAction={locked ? undefined : { label: 'Add new customer', onAction: () => setShowNewCustomer((v) => !v) }}
                        />
                        {showNewCustomer && !locked && (
                            <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 -mt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New customer</span>
                                    <button type="button" onClick={() => { setShowNewCustomer(false); setNewCustomerName(''); setNewCustomerError(''); }} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                                </div>
                                <Input placeholder="Customer name *" value={newCustomerName} onChange={(e) => { setNewCustomerName(e.target.value); setNewCustomerError(''); }} className="mb-2" />
                                {newCustomerError && <div className="text-xs text-danger-500 mb-2">{newCustomerError}</div>}
                                <Button text={createCustomer.isPending ? 'Creating…' : 'Create & select'} variant="primary" size="small" disabled={createCustomer.isPending} onClick={handleQuickCreate} />
                            </div>
                        )}
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Invoice Date <span className="text-danger-500">*</span></label>
                        <input type="date" className={ctl} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={locked} />
                    </div>
                    <div className="col-span-2">
                        <label className={lbl}>Due Date</label>
                        <input type="date" className={ctl} value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={locked} />
                        {customerTerms !== null && <div className="text-[11px] text-neutral-500 mt-1">{customerTerms === 0 ? 'Due on receipt' : `Net ${customerTerms} days`}</div>}
                    </div>
                    <div className="col-span-4">
                        <label className={lbl}>Invoice #</label>
                        <div className="flex gap-1">
                            <select className="h-9 px-1.5 rounded-md border border-neutral-300 bg-white text-xs w-[64px] shrink-0 disabled:bg-neutral-100" value={numberingMode} onChange={(e) => setNumberingMode(e.target.value as 'auto' | 'manual')} disabled={locked}>
                                <option value="auto">Auto</option>
                                <option value="manual">Manual</option>
                            </select>
                            <div className="flex-1 min-w-0">
                                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={numberingMode === 'auto' || locked}
                                    placeholder={numberingMode === 'auto' ? '—' : 'Invoice #'}
                                    className={`${ctl} text-right font-mono text-xs`} />
                                {numberingMode === 'auto' && !locked && <div className="text-[10px] text-neutral-500 mt-1 truncate" title={autoNumberPreview}>{autoNumberPreview}</div>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-neutral-200 px-1">
                <TabBtn id="items" label="Items" />
                <TabBtn id="info" label="Info &amp; tax" />
                <TabBtn id="attachments" label={`Attachments (${attachments.length})`} />
            </div>

            {activeTab === 'items' && (
                <>
                    <LineItemsTable
                        lines={doc.lines}
                        showTax={tax.enabled}
                        onChange={doc.updateLine}
                        onRemove={doc.removeLine}
                        onAddLine={doc.addLine}
                        searchSlot={searchSlot}
                        readOnly={locked}
                        isPriceLocked={(l) => Boolean(l.productId) && !canOverridePrice}
                    />
                    {stockWarnings.length > 0 && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning-50 border border-warning-200 text-[12px] text-warning-800">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{stockWarnings.length} line{stockWarnings.length > 1 ? 's' : ''} exceed available stock — inventory will go negative on posting.</span>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'info' && (
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={lbl}>Billing address</label>
                            <textarea className={`${ctl} h-[68px] py-2 resize-y`} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} disabled={locked} />
                        </div>
                        <div>
                            <label className={lbl}>Shipping address</label>
                            <textarea className={`${ctl} h-[68px] py-2 resize-y`} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} disabled={locked} />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={lbl}>PO number</label>
                            <input className={`${ctl} font-mono`} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} disabled={locked} />
                        </div>
                        <div>
                            <label className={lbl}>Shipping date</label>
                            <input type="date" className={ctl} value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} disabled={locked} />
                        </div>
                        <div>
                            <label className={lbl}>Document discount %</label>
                            <input type="number" className={`${ctl} text-right tabular-nums`} value={discountPct} onChange={(e) => setDiscountPct(parseFloat(e.target.value) || 0)} disabled={locked} />
                        </div>
                    </div>
                    <div>
                        <label className={lbl}>Internal notes</label>
                        <textarea className={`${ctl} h-[52px] py-2 resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
                    </div>

                    {/* Tax */}
                    <div className="border-t border-neutral-200 pt-3">
                        <div className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-2">Tax</div>
                        <div className="flex flex-wrap items-center gap-5">
                            <label className="flex items-center gap-2 cursor-pointer text-[13px] font-medium text-neutral-900">
                                <input type="checkbox" className="accent-primary-600 w-4 h-4" checked={tax.enabled} onChange={(e) => setTax((t) => ({ ...t, enabled: e.target.checked }))} disabled={locked} />
                                Apply PPN
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-neutral-700">
                                <input type="checkbox" className="accent-primary-600 w-4 h-4" checked={tax.inclusive} onChange={(e) => setTax((t) => ({ ...t, inclusive: e.target.checked }))} disabled={!tax.enabled || locked} />
                                Total already includes tax
                            </label>
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] text-neutral-700">Rate %</span>
                                <input type="number" className="w-20 h-8 px-2 text-[13px] text-right tabular-nums bg-white border border-neutral-300 rounded-md disabled:bg-neutral-100" value={tax.rate} onChange={(e) => setTax((t) => ({ ...t, rate: parseFloat(e.target.value) || 0 }))} disabled={!tax.enabled || locked} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'attachments' && (
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                    {!locked && (
                        <label className="border-2 border-dashed border-neutral-300 rounded-xl bg-neutral-50 p-8 text-center flex flex-col items-center gap-2 cursor-pointer hover:bg-neutral-100">
                            <Paperclip size={32} className="text-neutral-400" />
                            <span className="text-[13px] font-medium text-neutral-700">Browse files…</span>
                            <input type="file" multiple className="hidden" onChange={(e) => {
                                const files = Array.from(e.target.files || []).map((f) => ({ id: Date.now() + Math.random(), name: f.name, size: `${(f.size / 1024).toFixed(1)} KB` }));
                                setAttachments((a) => [...a, ...files]); e.target.value = '';
                            }} />
                        </label>
                    )}
                    {attachments.length > 0 ? (
                        <div className="grid grid-cols-2 gap-3 mt-4">
                            {attachments.map((f) => (
                                <div key={f.id} className="flex items-center gap-3 p-3 border border-neutral-200 rounded-lg relative pr-9">
                                    <FileText size={22} className="text-primary-600" />
                                    <div className="flex-1 min-w-0"><div className="text-[13px] font-medium truncate">{f.name}</div><div className="text-[11px] text-neutral-500">{f.size}</div></div>
                                    {!locked && <button onClick={() => setAttachments((a) => a.filter((x) => x.id !== f.id))} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-danger-500"><X size={16} /></button>}
                                </div>
                            ))}
                        </div>
                    ) : <div className="text-[12px] text-neutral-400 text-center mt-4">No attachments. (Metadata only — not yet persisted server-side.)</div>}
                </div>
            )}
        </>
    );

    const rail = (
        <>
            <DocumentTotals totals={totals} taxRate={tax.enabled ? tax.rate : undefined} withholdingRate={undefined} />
            {locked && (
                <SettlementCard
                    total={invoiceTotal}
                    paid={paidAmount}
                    returns={returnsAmount}
                    hideZeroRows
                    onOpenPayment={() => navigate('/ar/payments')}
                    onOpenReturns={() => navigate('/ar/credit-notes')}
                />
            )}
            <CustomerContextRail
                hasCustomer={!!customerId}
                customerName={firstStr(customer?.name) || 'Customer'}
                taxId={firstStr(customer?.npwp)}
                creditLimit={num(customer?.creditLimit) || undefined}
                outstanding={outstanding}
                orderTotal={totals.grandTotal}
                recentDocs={recentDocs}
            />
        </>
    );

    const statusTone: 'success' | 'danger' | 'warning' =
        status === 'Paid' ? 'success' : status === 'Overdue' ? 'danger' : status === 'Void' ? 'danger' : 'warning';

    return (
        <div className="p-4 lg:p-6">
            <DocumentFormLayout
                title={isEdit ? `Invoice ${invoiceNumber || ''}`.trim() : 'New Sales Invoice'}
                dirty={doc.dirty}
                saving={saving}
                onBack={() => navigateBack()}
                backLabel="Invoices"
                printOptions={[
                    { label: 'Print A4', hint: 'Standard paper', onClick: () => window.print() },
                    { label: 'Print A5', hint: 'Half-page', onClick: () => window.print() },
                ]}
                posted={locked}
                postedStatusLabel={locked ? status : undefined}
                postedStatusTone={statusTone}
                onEmail={locked ? handleEmail : undefined}
                moreItems={locked ? [
                    { label: 'Void invoice', danger: true, disabled: true, disabledHint: 'No reversal endpoint yet' },
                ] : undefined}
                onSaveDraft={() => { void persist(true); }}
                primaryLabel="Save & approve"
                primaryIcon={<CheckCircle2 size={13} />}
                onPrimary={() => { void persist(false); }}
                primaryOptions={[
                    { label: 'Save & approve', hint: 'Post to the ledger', onClick: () => { void persist(false); } },
                    { label: 'Save as draft', hint: 'Park without posting', onClick: () => { void persist(true); } },
                    ...(isEdit && status === 'Draft' ? [{ label: 'Delete draft', onClick: () => { void handleDelete(); } }] : []),
                ]}
                main={main}
                rail={rail}
            />
        </div>
    );
};

export default InvoiceFormV2;
