import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface InvoiceLineItem {
    id:          string | number;
    productId?:  string;
    code:        string;
    description: string;
    quantity:    number;
    unit:        string;
    price:       number;
    discount?:   number;
}

interface InvoiceAttachment {
    id: string | number;
    name: string;
    size: string;
    type: string;
}

interface InvoiceFormData {
    id?:             string;
    customerId:      string;
    email:           string;
    billingAddress:  string;
    shippingAddress: string;
    poNumber:        string;
    salesOrderId?:   string;
    issueDate:       string;
    dueDate:         string;
    shippingDate:    string;
    number:          string;
    discount:        number;
    notes:           string;
    items:           InvoiceLineItem[];
    attachments:     InvoiceAttachment[];
    currency:        string;
    invoiceType:     string;
}

interface InvoiceTaxSettings {
    enabled:   boolean;
    inclusive: boolean;
    rate:      number;
}

interface TableErrorBoundaryProps {
    children: React.ReactNode;
}

interface TableErrorBoundaryState {
    hasError: boolean;
    errorInfo: Error | null;
}

interface InvoiceEditorState {
    openInvoiceId?: string;
    mode?: string;
    returnToWorkbench?: boolean;
    catalogState?: {
        searchTerm?: string;
        status?: string;
        dateFrom?: string;
        dateTo?: string;
    };
}

type CustomerLike = any;
type InvoiceLike = any;
type ProductLike = any;
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { Printer, Save, Search, Info, Package, Paperclip, FileText, X, AlertTriangle } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import DocumentActionBar from '../../components/UI/DocumentActionBar';

import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useExtraAction } from '../../hooks/useModulePermissions';
import { useCustomers, useCreateCustomer, useInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice } from '../../hooks/useAR';
import { useItems } from '../../hooks/useInventory';
import { useDraftAutosave } from '../../hooks/useDraftAutosave';

class TableErrorBoundary extends React.Component<TableErrorBoundaryProps, TableErrorBoundaryState> {
    constructor(props: TableErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, errorInfo: null };
    }
    static getDerivedStateFromError(error: Error): TableErrorBoundaryState {
        return { hasError: true, errorInfo: error };
    }
    render() {
        if (this.state.hasError) {
            return <div className="p-4 bg-danger-50 text-danger-600 rounded-lg whitespace-pre-wrap font-mono text-sm shadow border border-danger-200">
                CRASH: {this.state.errorInfo?.toString()}{'\n'}
                {this.state.errorInfo?.stack}
            </div>;
        }
        return this.props.children;
    }
}

interface InvoiceFormProps {
    mode?: 'create' | 'edit';
    /** Present only when rendered inside the workspace shell. */
    workspaceTabId?: string;
    /** Record id when rendered inside the workspace (replaces location.state.openInvoiceId). */
    recordId?: string;
}

/** Shape of the recoverable draft autosaved into a workspace tab. */
interface InvoiceDraft {
    customerId: string;
    email: string;
    billingAddress: string;
    shippingAddress: string;
    poNumber: string;
    issueDate: string;
    dueDate: string;
    shippingDate: string;
    number: string;
    discount: number;
    notes: string;
    invoiceType: string;
    items: InvoiceLineItem[];
    taxSettings: InvoiceTaxSettings;
}

const InvoiceForm = ({ workspaceTabId, recordId }: InvoiceFormProps = {}) => {
    const navigate = useNavigate();
    const location = useLocation() as { state?: InvoiceEditorState };
    // In workspace mode the editing target comes from the tab's recordId; in
    // route mode it comes from location.state (set by the workbench's Edit action).
    const resolvedEditId = recordId ?? location.state?.openInvoiceId ?? null;
    const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);

    // Recover an autosaved draft for this workspace tab (workspace mode only).
    const draftSeed = useWorkspaceStore((s) =>
        (workspaceTabId ? s.tabs.find((t) => t.id === workspaceTabId)?.draft : undefined) as
            | Partial<InvoiceDraft>
            | undefined,
    );
    const [activeTab, setActiveTab] = useState<'items' | 'info' | 'attachments'>('items');
    const [numberingMode, setNumberingMode] = useState<'auto' | 'manual'>('auto');
    const [selectedCustomerTerms, setSelectedCustomerTerms] = useState<number | null>(null);

    // Customer State
    const [masterCreditLimit, setMasterCreditLimit] = useState(5000000); // Mocked from Settings

    // Manage customers state dynamically
    const { data: customersData, isLoading: customersLoading } = useCustomers();
    const customerList = (customersData?.data || []) as CustomerLike[];
    const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();
    const invoices = ((invoicesData?.data || []).filter(Boolean)) as InvoiceLike[];
    const { data: itemsData, isLoading: itemsLoading } = useItems();
    const products = (itemsData?.data || []) as ProductLike[];
    const createInvoice = useCreateInvoice();
    const updateInvoiceMutation = useUpdateInvoice();
    const deleteInvoice = useDeleteInvoice();

    // Sales policy enforcement (org-wide rules + role overrides)
    const salesPolicy = useSettingsStore((s) => s.salesPolicy);
    const canBypassBelowCost = useExtraAction('ar_invoices', 'sellBelowCost');
    const canBypassRequireSO = useExtraAction('ar_invoices', 'invoiceWithoutSO');
    const canOverridePrice   = useExtraAction('ar_invoices', 'overridePrice');

    const globalTaxSettings = useSettingsStore(s => s.taxSettings);
    const docNumbering = useSettingsStore(s => s.documentNumbering?.ar_invoice ?? { prefix: 'INV', resetPeriod: 'monthly', seqLength: 6 });

    const [formData, setFormData] = useState<InvoiceFormData>({
        customerId: draftSeed?.customerId ?? '',
        email: draftSeed?.email ?? '',
        billingAddress: draftSeed?.billingAddress ?? '',
        shippingAddress: draftSeed?.shippingAddress ?? '',
        poNumber: draftSeed?.poNumber ?? '',
        issueDate: draftSeed?.issueDate ?? new Date().toISOString().split('T')[0],
        dueDate: draftSeed?.dueDate ?? '',
        shippingDate: draftSeed?.shippingDate ?? new Date().toISOString().split('T')[0],
        number: draftSeed?.number ?? '',
        discount: draftSeed?.discount ?? 0,
        notes: draftSeed?.notes ?? '',
        items: draftSeed?.items ?? [],
        attachments: [],
        currency: 'IDR',
        invoiceType: draftSeed?.invoiceType ?? 'Sales Invoice'
    });

    const [taxSettings, setTaxSettings] = useState({
        enabled: draftSeed?.taxSettings?.enabled ?? globalTaxSettings.enabled,
        inclusive: draftSeed?.taxSettings?.inclusive ?? globalTaxSettings.inclusiveByDefault,
        rate: draftSeed?.taxSettings?.rate ?? globalTaxSettings.defaultRate
    } as InvoiceTaxSettings);



    // Item Search State
    const [itemSearchTerm, setItemSearchTerm] = useState('');
    const [showItemResults, setShowItemResults] = useState(false);
    const itemSearchRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // Numbering Configuration (from Settings)
    const numberingConfig = {
        prefix: docNumbering.prefix,
        reset: docNumbering.resetPeriod,
        seqLength: docNumbering.seqLength,
    };

    const getMaxSequence = () => {
        const nums = invoices
            .map(inv => inv.number || '')
            .map(n => {
                const match = n.match(/(\d{3,})$/);
                return match ? parseInt(match[1], 10) : 0;
            });
        return Math.max(0, ...nums);
    };

    const [nextSequence, setNextSequence] = useState(getMaxSequence() + 1);

    const formatSequence = (num: number) => String(num).padStart(numberingConfig.seqLength, '0');

    const buildAutoNumber = (dateStr: string) => {
        const date = dateStr ? new Date(dateStr) : new Date();
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${numberingConfig.prefix}/${yyyy}/${mm}/${formatSequence(nextSequence)}`;
    };

    const autoNumberPreview = buildAutoNumber(formData.issueDate);

    useEffect(() => {
        // A recovered draft already holds the user's in-progress edits — don't
        // overwrite it from the saved record.
        if (draftSeed) {
            if (resolvedEditId) setEditingInvoiceId(resolvedEditId);
            return;
        }
        // Route mode requires location.state.mode === 'edit'; workspace mode
        // signals edit via a non-null recordId.
        const isEditTarget = recordId ? true : location.state?.mode === 'edit';
        if (resolvedEditId && isEditTarget && invoices.length > 0) {
            const exists = invoices.find((inv) => inv.id === resolvedEditId);
            if (exists) {
                setEditingInvoiceId(exists.id);
                setNumberingMode('manual');
                setFormData(prev => ({
                    ...prev,
                    customerId: exists.customerId || '',
                    issueDate: exists.issueDate || prev.issueDate,
                    dueDate: exists.dueDate || '',
                    number: exists.number || '',
                    notes: exists.notes || '',
                    items: (exists.items || []) as InvoiceLineItem[],
                }));
                setActiveTab('items');
            }
        }
    }, [location.state, recordId, resolvedEditId, draftSeed, invoices.length]);

    // Click outside to close item search range
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (itemSearchRef.current && !itemSearchRef.current.contains(event.target as Node)) {
                setShowItemResults(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [itemSearchRef]);

    const handleCustomerChange = (val: string) => {
        const custId = val;
        const customer = customerList.find((c) => c.id === custId);

        if (customer) {
            const issueDate = new Date(formData.issueDate);
            issueDate.setDate(issueDate.getDate() + (customer.paymentTerms || 30));
            const newDueDate = issueDate.toISOString().split('T')[0];

            setFormData(prev => ({
                ...prev,
                customerId: custId,
                email: customer.email,
                billingAddress: customer.billingAddress,
                shippingAddress: customer.shippingAddress,
                discount: customer.defaultDiscount,
                dueDate: newDueDate
            }));
            setSelectedCustomerTerms(customer.paymentTerms ?? null);
        } else {
            setFormData(prev => ({ ...prev, customerId: custId, email: '', billingAddress: '', shippingAddress: '' }));
            setSelectedCustomerTerms(null);
        }
    };

    // Inline quick-create customer
    const createCustomer = useCreateCustomer();
    const [showNewCustomer, setShowNewCustomer] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerError, setNewCustomerError] = useState('');

    const handleQuickCreateCustomer = async () => {
        const trimmed = newCustomerName.trim();
        if (!trimmed) { setNewCustomerError('Name is required.'); return; }
        const autoCode = trimmed.replace(/\s+/g, '-').toUpperCase().slice(0, 10);
        try {
            const created = await createCustomer.mutateAsync({ name: trimmed, code: autoCode }) as { id: string };
            setFormData(prev => ({ ...prev, customerId: created.id }));
            setShowNewCustomer(false);
            setNewCustomerName('');
            setNewCustomerError('');
        } catch (e) {
            setNewCustomerError(e instanceof Error ? e.message : 'Failed to create customer.');
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // --- QUICK ADD ITEM LOGIC ---
    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
        p.id.toLowerCase().includes(itemSearchTerm.toLowerCase())
    );

    const selectProduct = (product: ProductLike) => {
        const newItem: InvoiceLineItem = {
            id: Date.now(),
            productId: product.id,
            code: String(product.code || product.id || ''),
            description: String(product.name || ''),
            quantity: 1,
            unit: 'PCS',
            price: Number(product.price || 0),
            discount: 0
        };

        setFormData(prev => ({
            ...prev,
            items: [...prev.items, newItem]
        }));

        setItemSearchTerm('');
        setShowItemResults(false);
    };

    const addCustomItem = () => {
        const newItem: InvoiceLineItem = {
            id: Date.now(),
            productId: '',
            code: 'CUSTOM',
            description: itemSearchTerm,
            quantity: 1,
            unit: 'PCS',
            price: 0,
            discount: 0
        };

        setFormData(prev => ({
            ...prev,
            items: [...prev.items, newItem]
        }));

        setItemSearchTerm('');
        setShowItemResults(false);
    };

    const removeItem = (id: string | number) => {
        setFormData(prev => ({
            ...prev,
            items: prev.items.filter(item => item.id !== id)
        }));
    };

    const handleItemChange = (
        id: string | number,
        field: keyof InvoiceLineItem,
        value: string | number
    ) => {
        setFormData(prev => {
            const newItems = prev.items.map(item => {
                if (item.id === id) {
                    return { ...item, [field]: value } as InvoiceLineItem;
                }
                return item;
            });
            return { ...prev, items: newItems };
        });
    };

    const calculateItemTotal = (item: InvoiceLineItem) => {
        const sub = item.quantity * item.price;
        const disc = sub * ((item.discount || 0) / 100);
        return sub - disc;
    };

    const calculateSubtotal = () => formData.items.reduce((acc, item) => acc + calculateItemTotal(item), 0);

    const calculateDiscountAmount = (subtotal: number) => subtotal * (formData.discount / 100);

    const calculateTaxAmount = (netAmount: number) => {
        if (!taxSettings.enabled) return 0;
        const rate = taxSettings.rate / 100;
        if (taxSettings.inclusive) {
            return netAmount - (netAmount / (1 + rate));
        }
        return netAmount * rate;
    };

    const calculateTotal = () => {
        const subtotal = calculateSubtotal();
        const discount = calculateDiscountAmount(subtotal);
        const net = subtotal - discount;
        const tax = calculateTaxAmount(net);
        return taxSettings.enabled && !taxSettings.inclusive ? net + tax : net;
    };

    const isSaving = createInvoice.isPending || updateInvoiceMutation.isPending;
    const isPageLoading = customersLoading || invoicesLoading || itemsLoading;

    // ── Workspace draft autosave + dirty mirroring (workspace mode only) ──────
    const isEditMode = Boolean(editingInvoiceId);
    const snapshot = useMemo<InvoiceDraft>(() => ({
        customerId: formData.customerId,
        email: formData.email,
        billingAddress: formData.billingAddress,
        shippingAddress: formData.shippingAddress,
        poNumber: formData.poNumber,
        issueDate: formData.issueDate,
        dueDate: formData.dueDate,
        shippingDate: formData.shippingDate,
        number: formData.number,
        discount: formData.discount,
        notes: formData.notes,
        invoiceType: formData.invoiceType,
        items: formData.items,
        taxSettings,
    }), [formData, taxSettings]);

    useDraftAutosave(workspaceTabId, snapshot);

    const dirty = formData.items.length > 0 || !!formData.customerId
        || !!formData.poNumber || !!formData.notes || formData.discount > 0;

    const setStatus = useWorkspaceStore((s) => s.setStatus);
    useEffect(() => {
        if (!workspaceTabId) return;
        setStatus(workspaceTabId, dirty ? (isEditMode ? 'dirty' : 'new') : (isEditMode ? 'clean' : 'new'));
    }, [workspaceTabId, dirty, isEditMode, setStatus]);

    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const clearDraft = useWorkspaceStore((s) => s.clearDraft);

    /**
     * Finalize a save. In workspace mode the tab owns navigation — clear the
     * recovered draft and close the tab. In route mode run the legacy
     * post-save navigation (workbench return or list redirect), byte-for-byte.
     */
    const finishSave = (savedInvoiceId: string, savedNumber: string): boolean => {
        if (workspaceTabId) {
            clearDraft(workspaceTabId);
            closeTab(workspaceTabId);
            return true;
        }
        if (location.state?.returnToWorkbench) {
            const targetInvoiceId = location.state?.openInvoiceId || savedInvoiceId;
            const query = new URLSearchParams();
            const catalogState = location.state?.catalogState || {};
            if (catalogState.searchTerm) query.set('search', catalogState.searchTerm);
            if (catalogState.status) query.set('status', catalogState.status);
            if (catalogState.dateFrom) query.set('from', catalogState.dateFrom);
            if (catalogState.dateTo) query.set('to', catalogState.dateTo);
            if (targetInvoiceId) query.set('invoiceId', targetInvoiceId);

            navigate(`/ar/invoices/workbench?${query.toString()}`, {
                state: {
                    invoiceId: targetInvoiceId,
                    catalogState,
                    updatedNumber: savedNumber
                }
            });
            return true;
        }

        navigate('/ar/invoices');
        return true;
    };

    const persistInvoice = async (saveAsDraft: boolean) => {
        // Org-wide sales policy enforcement applies when approving; drafts are
        // work-in-progress that can be parked without passing policy gates.
        // (Role overrides bypass these checks.)
        if (!saveAsDraft) {
        if (salesPolicy.requireSalesOrder && !formData.salesOrderId && !canBypassRequireSO) {
            window.alert('A Sales Order is required before creating an invoice. Link a Sales Order or ask an administrator to grant the "Create Invoice Without Sales Order" override.');
            return;
        }
        if (salesPolicy.blockSellBelowCost && !canBypassBelowCost) {
            const violator = formData.items.find((line) => {
                const product = products.find((p) => String(p.id) === String(line.productId));
                const cost = Number(product?.cost ?? 0);
                return cost > 0 && line.price > 0 && line.price < cost;
            });
            if (violator) {
                window.alert(`Line "${violator.description}" is priced below cost. Adjust the price or ask an administrator to grant the "Sell Below Cost" override.`);
                return;
            }
        }
        }

        const cleanedItems = formData.items.filter((line) => String(line.description || '').trim());
        if (!formData.customerId) { window.alert('Select a customer first.'); return; }
        if (!formData.issueDate) { window.alert('Invoice date is required.'); return; }
        if (cleanedItems.length === 0) { window.alert('Add at least one line item.'); return; }

        const currentStatus = editingInvoiceId
            ? (invoices.find(inv => inv.id === editingInvoiceId)?.status || 'Draft')
            : 'Draft';
        if (editingInvoiceId && currentStatus !== 'Draft') {
            window.alert('Only Draft invoices can be edited. Sent/Paid invoices are locked.');
            return;
        }

        let savedInvoiceId = editingInvoiceId || '';
        let savedNumber = formData.number;

        try {
            if (editingInvoiceId) {
                // Full edits are only allowed while DRAFT (enforced server-side).
                // Status transition to SENT in the same update triggers posting.
                const subtotalAmt = calculateSubtotal();
                const discountAmt = calculateDiscountAmount(subtotalAmt);
                const netAmt = subtotalAmt - discountAmt;
                const taxAmt = calculateTaxAmount(netAmt);
                await updateInvoiceMutation.mutateAsync({
                    id: editingInvoiceId,
                    customerId: formData.customerId,
                    invoiceType: formData.invoiceType || 'Sales Invoice',
                    issueDate: new Date(formData.issueDate).toISOString(),
                    dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : null,
                    shippingDate: formData.shippingDate ? new Date(formData.shippingDate).toISOString() : null,
                    poNumber: formData.poNumber || null,
                    billingAddress: formData.billingAddress || null,
                    shippingAddress: formData.shippingAddress || null,
                    notes: formData.notes || null,
                    taxEnabled: taxSettings.enabled,
                    taxInclusive: taxSettings.inclusive,
                    taxRate: taxSettings.rate,
                    subtotal: subtotalAmt,
                    discountPct: Number(formData.discount || 0),
                    discountAmount: discountAmt,
                    taxAmount: taxAmt,
                    totalAmount: calculateTotal(),
                    lines: cleanedItems.map((line, idx) => ({
                        lineNo: idx + 1,
                        itemId: line.productId || null,
                        description: line.description,
                        quantity: Number(line.quantity || 0),
                        unit: line.unit || 'PCS',
                        price: Number(line.price || 0),
                        discountPct: Number(line.discount || 0),
                        lineSubtotal: Math.round(Number(line.quantity || 0) * Number(line.price || 0) * (1 - Number(line.discount || 0) / 100) * 100) / 100,
                    })),
                    ...(saveAsDraft ? {} : { status: 'Sent' }),
                } as any);
            } else {
                // POST always creates a DRAFT (createInvoiceInputSchema shape;
                // the server assigns the number and computes totals).
                const created = await createInvoice.mutateAsync({
                    customerId: formData.customerId,
                    invoiceType: formData.invoiceType || 'Sales Invoice',
                    issueDate: formData.issueDate,
                    ...(formData.dueDate && { dueDate: formData.dueDate }),
                    ...(formData.shippingDate && { shippingDate: formData.shippingDate }),
                    ...(formData.poNumber && { poNumber: formData.poNumber }),
                    ...(formData.billingAddress && { billingAddress: formData.billingAddress }),
                    ...(formData.shippingAddress && { shippingAddress: formData.shippingAddress }),
                    currency: 'IDR',
                    discountPct: Number(formData.discount || 0),
                    tax: {
                        enabled: taxSettings.enabled,
                        inclusive: taxSettings.inclusive,
                        rate: taxSettings.rate,
                    },
                    ...(formData.notes && { notes: formData.notes }),
                    lines: cleanedItems.map((line) => ({
                        ...(line.productId && { itemId: line.productId }),
                        ...(line.code && { code: line.code }),
                        description: line.description,
                        quantity: Number(line.quantity || 0),
                        unit: line.unit || 'PCS',
                        price: Number(line.price || 0),
                        discountPct: Number(line.discount || 0),
                    })),
                }) as { id: string; number: string };
                savedInvoiceId = created.id;
                savedNumber = created.number;

                // Approve = status-only DRAFT -> SENT transition (posts to GL).
                if (!saveAsDraft) {
                    await updateInvoiceMutation.mutateAsync({ id: created.id, status: 'Sent' });
                }
            }
        } catch (err) {
            window.alert(`Failed to save invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return;
        }

        finishSave(savedInvoiceId, savedNumber);
    };

    const handlePrint = () => {
        window.print();
    };

    // Attachment Logic
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const newAttachments = files.map(file => ({
            id: Date.now() + Math.random(),
            name: file.name,
            size: (file.size / 1024).toFixed(2) + ' KB',
            type: file.type
        }));

        setFormData(prev => ({
            ...prev,
            attachments: [...prev.attachments, ...newAttachments]
        }));

        e.target.value = '';
    };

    const removeAttachment = (id: string | number) => {
        setFormData(prev => ({
            ...prev,
            attachments: prev.attachments.filter(a => a.id !== id)
        }));
    };

    // Prepare options for SearchableSelect
    const customerOptions = customerList.map(c => ({
        value: c.id,
        label: c.name,
        subLabel: c.code || c.email || ''
    }));

    const TabButton = ({ id, label, icon: Icon }: { id: 'items' | 'info' | 'attachments'; label: string; icon: React.ComponentType<{ size?: number }> }) => (
        <button
            type="button"
            className={`inline-flex items-center gap-2 py-2.5 px-3.5 border border-transparent border-b-2 bg-transparent font-semibold text-sm cursor-pointer transition-colors ${activeTab === id ? 'text-primary-700 border-b-primary-600' : 'text-neutral-600 border-b-transparent hover:text-neutral-900'}`}
            onClick={() => setActiveTab(id)}
        >
            <span className="flex items-center"><Icon size={14} /></span>
            {label}
        </button>
    );

    const handleBack = () => {
        if (location.state?.returnToWorkbench) {
            const query = new URLSearchParams();
            const catalogState = location.state?.catalogState || {};
            if (catalogState.searchTerm) query.set('search', catalogState.searchTerm);
            if (catalogState.status) query.set('status', catalogState.status);
            if (catalogState.dateFrom) query.set('from', catalogState.dateFrom);
            if (catalogState.dateTo) query.set('to', catalogState.dateTo);
            if (location.state?.openInvoiceId) query.set('invoiceId', location.state.openInvoiceId);
            navigate(`/ar/invoices/workbench?${query.toString()}`, {
                state: {
                    invoiceId: location.state?.openInvoiceId || '',
                    catalogState
                }
            });
            return;
        }
        navigate('/ar/invoices');
    };

    return (
        <FormPage
            containerClassName="ar-module invoice-form"
            title="Sales Invoice"
            onBack={handleBack}
            isLoading={isPageLoading}
            sticky
            actions={(
                <DocumentActionBar
                    entityType="SalesInvoice"
                    entityId={editingInvoiceId ?? undefined}
                    isSaving={isSaving}
                    saveLabel="Save & Approve"
                    onSave={() => { void persistInvoice(false); }}
                    onSaveDraft={() => { void persistInvoice(true); }}
                    onPrint={handlePrint}
                    onDelete={editingInvoiceId && invoices.find(inv => inv.id === editingInvoiceId)?.status === 'Draft'
                        ? () => { void (async () => { try { await deleteInvoice.mutateAsync(editingInvoiceId); handleBack(); } catch (e) { window.alert(`Failed to delete: ${e instanceof Error ? e.message : 'error'}`); } })(); }
                        : undefined}
                    canDelete={Boolean(editingInvoiceId) && invoices.find(inv => inv.id === editingInvoiceId)?.status === 'Draft'}
                />
            )}
        >
            <form onSubmit={(e) => e.preventDefault()}>
                    {/* Header Section: compact single row */}
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4 mt-4 border-t-3 border-t-primary-500 mb-4">
                        <div className="grid grid-cols-12 gap-3">
                            {/* Customer */}
                            <div className="col-span-4">
                                <SearchableSelect
                                    label="Customer *"
                                    options={customerOptions}
                                    value={formData.customerId}
                                    onChange={(val) => { handleCustomerChange(val); setShowNewCustomer(false); }}
                                    footerAction={{ label: 'Add new customer', onAction: () => setShowNewCustomer(v => !v) }}
                                    placeholder="Search & Select Customer..."
                                />
                                {showNewCustomer && (
                                    <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 -mt-2">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New Customer</span>
                                            <button type="button" onClick={() => { setShowNewCustomer(false); setNewCustomerName(''); setNewCustomerError(''); }} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                                        </div>
                                        <Input placeholder="Customer name *" value={newCustomerName} onChange={e => { setNewCustomerName(e.target.value); setNewCustomerError(''); }} className="mb-2" />
                                        {newCustomerError && <div className="form-feedback invalid-feedback mb-2">{newCustomerError}</div>}
                                        <Button text={createCustomer.isPending ? 'Creating...' : 'Create & Select'} variant="primary" size="small" disabled={createCustomer.isPending} onClick={handleQuickCreateCustomer} />
                                    </div>
                                )}
                            </div>
                            {/* Invoice Date */}
                            <div className="col-span-2">
                                <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Invoice Date *</label>
                                <Input type="date" name="issueDate" value={formData.issueDate} onChange={handleChange} />
                            </div>
                            {/* Due Date */}
                            <div className="col-span-2">
                                <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Due Date</label>
                                <Input type="date" name="dueDate" value={formData.dueDate} onChange={handleChange} />
                                {selectedCustomerTerms !== null && (
                                    <div className="text-[11px] text-neutral-500 mt-1">
                                        {selectedCustomerTerms === 0 ? 'Due on Receipt' : `Net ${selectedCustomerTerms} days`}
                                    </div>
                                )}
                            </div>
                            {/* Invoice Type */}
                            <div className="col-span-2">
                                <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Invoice Type</label>
                                <select
                                    className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    value={formData.invoiceType}
                                    onChange={(e) => setFormData(prev => ({ ...prev, invoiceType: e.target.value }))}
                                >
                                    <option>Sales Invoice</option>
                                </select>
                            </div>
                            {/* Invoice # */}
                            <div className="col-span-2">
                                <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Invoice #</label>
                                <div className="flex gap-1 items-start">
                                    <select
                                        className="h-10 px-1.5 rounded-md border border-neutral-300 bg-neutral-0 text-xs focus:border-primary-500 focus:outline-0 w-[58px] shrink-0"
                                        value={numberingMode}
                                        onChange={(e) => setNumberingMode(e.target.value as 'auto' | 'manual')}
                                    >
                                        <option value="auto">Auto</option>
                                        <option value="manual">Manual</option>
                                    </select>
                                    <div className="flex-1 min-w-0">
                                        <input
                                            value={formData.number}
                                            onChange={handleChange}
                                            name="number"
                                            disabled={numberingMode === 'auto'}
                                            placeholder={numberingMode === 'auto' ? '—' : 'Invoice #'}
                                            className="block w-full px-2 text-xs leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 text-right font-bold tracking-[0.5px]"
                                        />
                                        {numberingMode === 'auto' && (
                                            <div className="text-[10px] text-neutral-500 mt-1 truncate" title={autoNumberPreview}>
                                                {autoNumberPreview}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* TABS Navigation */}
                    <div className="flex gap-2 border-b border-neutral-200 bg-neutral-0 px-2">
                        <TabButton id="items" label="Item Details" icon={Package} />
                        <TabButton id="info" label="Logistics & Notes" icon={Info} />
                        <TabButton id="attachments" label={`Attachments (${formData.attachments.length})`} icon={Paperclip} />
                    </div>

                    {/* TAB CONTENT: ITEMS */}
                    {activeTab === 'items' && (
                        <>
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg mt-4 mb-4">

                                {/* QUICK ADD SEARCH BAR */}
                                <div className="py-3 px-4 bg-neutral-50 border-b border-neutral-200 relative rounded-t-lg">
                                    <div className="relative flex items-center" ref={itemSearchRef}>
                                        <Search size={18} className="absolute left-3 text-neutral-400" />
                                        <input
                                            className="w-full h-10 pl-10 pr-3 rounded-lg border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                            placeholder="Type to search items or add custom line..."
                                            value={itemSearchTerm}
                                            onChange={(e) => {
                                                setItemSearchTerm(e.target.value);
                                                setShowItemResults(true);
                                            }}
                                            onFocus={() => setShowItemResults(true)}
                                        />

                                        {/* Autocomplete Dropdown */}
                                        {showItemResults && itemSearchTerm && (
                                            <div className="absolute top-full left-0 right-0 bg-neutral-0 border border-neutral-200 rounded-lg shadow-md mt-1 max-h-[300px] overflow-y-auto z-50">
                                                {filteredProducts.length > 0 ? (
                                                    filteredProducts.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => selectProduct(p)}
                                                            className="p-3 flex justify-between items-center cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 last:border-0"
                                                        >
                                                            <div>
                                                                <div className="font-semibold text-[0.95rem]">{p.name}</div>
                                                                <div className="text-xs text-neutral-500">{p.code} • Stock: {(p.currentStock ?? p.stock ?? 0).toLocaleString()}</div>
                                                            </div>
                                                            <div className="font-bold text-success-600">
                                                                {formatIDR(p.price)}
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div
                                                        onClick={addCustomItem}
                                                        className="p-3 cursor-pointer text-primary-600 text-center hover:bg-primary-50"
                                                    >
                                                        <b>+ Add "{itemSearchTerm}"</b> as a new line item
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr>
                                            <th className="p-2 border-b border-neutral-200 font-semibold text-neutral-600 text-left w-[36%]">Item Info</th>
                                            <th className="p-2 border-b border-neutral-200 font-semibold text-neutral-600 text-center w-[12%]">Qty</th>
                                            <th className="p-2 border-b border-neutral-200 font-semibold text-neutral-600 text-center w-[12%]">Unit</th>
                                            <th className="p-2 border-b border-neutral-200 font-semibold text-neutral-600 text-right w-[14%]">Price</th>
                                            <th className="p-2 border-b border-neutral-200 font-semibold text-neutral-600 text-right w-[10%]">Disc %</th>
                                            <th className="p-2 border-b border-neutral-200 font-semibold text-neutral-600 text-right w-[12%]">Line Total</th>
                                            <th className="p-2 border-b border-neutral-200 w-[4%]"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {formData.items.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="text-center p-8 border-b border-neutral-100">
                                                    <div className="text-neutral-500 font-medium mb-1">No items added</div>
                                                    <div className="text-neutral-400 text-xs">Use the search bar above to add products</div>
                                                </td>
                                            </tr>
                                        ) : formData.items.map((item, index) => (
                                            <tr key={item.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                                                <td className="p-2 align-top">
                                                    <div className="text-xs font-semibold text-neutral-600 mb-1">{item.code}</div>
                                                    <input
                                                        value={item.description}
                                                        onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                                                        className="w-full text-sm border-0 bg-transparent p-0 m-0 focus:ring-0 text-neutral-900 placeholder-neutral-400"
                                                        placeholder="Description"
                                                    />
                                                    {(() => {
                                                        if (!item.productId) return null;
                                                        const prod = products.find((p: ProductLike) => p.id === item.productId);
                                                        if (!prod) return null;
                                                        const avail = prod.currentStock ?? prod.stock ?? 0;
                                                        if (item.quantity > avail) {
                                                            return (
                                                                <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-600">
                                                                    <AlertTriangle size={11} />
                                                                    Only {avail} available — stock will go negative
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </td>
                                                <td className="p-2 align-top">
                                                    <Input
                                                        type="number"
                                                        value={item.quantity}
                                                        onChange={(e) => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                                                        inputClassName="text-sm h-8 text-center"
                                                    />
                                                </td>
                                                <td className="p-2 align-top">
                                                    <Input
                                                        type="text"
                                                        value={item.unit}
                                                        onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                                                        inputClassName="text-sm h-8 text-center"
                                                    />
                                                </td>
                                                <td className="p-2 align-top">
                                                    <Input
                                                        type="number"
                                                        value={item.price}
                                                        disabled={Boolean(item.productId) && !canOverridePrice}
                                                        onChange={(e) => handleItemChange(item.id, 'price', Number(e.target.value))}
                                                        inputClassName="text-sm h-8 text-right"
                                                    />
                                                </td>
                                                <td className="p-2 align-top">
                                                    <Input
                                                        type="number"
                                                        value={item.discount}
                                                        onChange={(e) => handleItemChange(item.id, 'discount', Number(e.target.value))}
                                                        inputClassName="text-sm h-8 text-right"
                                                    />
                                                </td>
                                                <td className="p-2 align-top text-right font-bold text-neutral-800 pt-3.5">
                                                    {formatIDR(calculateItemTotal(item))}
                                                </td>
                                                <td className="p-2 align-top text-center pt-3">
                                                    <button
                                                        onClick={() => removeItem(item.id)}
                                                        className="text-neutral-400 hover:text-danger-500 bg-transparent border-0 cursor-pointer"
                                                        title="Remove Item"
                                                    >
                                                        <X size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Footer Section: Totals Aligned to Right */}
                            <div className="flex justify-end mt-4">
                                <div className="w-[320px]">
                                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg shadow-sm flex flex-col h-full p-4">
                                        {(() => {
                                            const subtotal = calculateSubtotal();
                                            const discountAmt = calculateDiscountAmount(subtotal);
                                            const net = subtotal - discountAmt;
                                            const taxAmt = calculateTaxAmount(net);
                                            return (
                                                <>
                                                    <div className="flex justify-between items-center mb-2 text-sm text-neutral-600">
                                                        <span>Subtotal</span>
                                                        <span>{formatIDR(subtotal)}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center mb-2 font-semibold text-neutral-800">
                                                        <span>Discount %</span>
                                                        <div className="w-[100px]">
                                                            <input
                                                                type="number"
                                                                className="w-full h-8 px-2 rounded border border-neutral-300 bg-neutral-0 text-sm text-right focus:border-primary-500 focus:outline-0"
                                                                value={formData.discount}
                                                                onChange={(e) => setFormData({ ...formData, discount: parseFloat(e.target.value) || 0 })}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-between items-center mb-2 text-sm text-neutral-600">
                                                        <span>Discount Amount</span>
                                                        <span>-{formatIDR(discountAmt)}</span>
                                                    </div>
                                                    {taxSettings.enabled && (
                                                        <div className="flex justify-between items-center mb-3 text-sm text-neutral-600">
                                                            <span>
                                                                Tax ({taxSettings.rate}%){taxSettings.inclusive ? ' incl.' : ''}
                                                            </span>
                                                            <span>{formatIDR(taxAmt)}</span>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-neutral-200">
                                                        <span className="font-bold text-neutral-900 text-lg">Total</span>
                                                        <span className="font-bold text-primary-700 text-xl">{formatIDR(calculateTotal())}</span>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* TAB CONTENT: INFO */}
                    {activeTab === 'info' && (
                        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 mb-4">
                            <div className="grid grid-cols-12 gap-5 mb-5">
                                <div className="col-span-6">
                                    <label className="block mb-2 text-sm font-semibold text-neutral-700">Billing Address</label>
                                    <textarea
                                        className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] resize-y"
                                        rows={4}
                                        value={formData.billingAddress}
                                        onChange={handleChange}
                                        name="billingAddress"
                                    />
                                </div>
                                <div className="col-span-6">
                                    <label className="block mb-2 text-sm font-semibold text-neutral-700">Shipping Address</label>
                                    <textarea
                                        className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] resize-y"
                                        rows={4}
                                        value={formData.shippingAddress}
                                        onChange={handleChange}
                                        name="shippingAddress"
                                    />
                                </div>
                            </div>

                            <div className="h-[1px] bg-neutral-200 my-6"></div>

                            <div className="grid grid-cols-12 gap-4">
                                <div className="col-span-4">
                                    <label className="form-label">PO Number</label>
                                    <Input value={formData.poNumber} onChange={handleChange} name="poNumber" />
                                </div>
                                <div className="col-span-4">
                                    <label className="form-label">Shipping Date</label>
                                    <Input type="date" value={formData.shippingDate} onChange={handleChange} name="shippingDate" />
                                </div>
                                <div className="col-span-4">
                                    <label className="form-label">Internal Notes</label>
                                    <textarea
                                        className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] resize-y"
                                        rows={1}
                                        value={formData.notes}
                                        onChange={handleChange}
                                        name="notes"
                                    />
                                </div>
                            </div>

                            <div className="h-[1px] bg-neutral-200 my-4"></div>

                            <div className="grid grid-cols-12 gap-4">
                                <div className="col-span-12 font-bold text-neutral-800 mb-2 border-b border-neutral-100 pb-2">Tax</div>
                                <div className="col-span-4">
                                    <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 select-none">
                                        <input
                                            type="checkbox"
                                            checked={taxSettings.enabled}
                                            onChange={(e) => setTaxSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                                        />
                                        Apply Tax
                                    </label>
                                </div>
                                <div className="col-span-4">
                                    <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 select-none">
                                        <input
                                            type="checkbox"
                                            checked={taxSettings.inclusive}
                                            onChange={(e) => setTaxSettings(prev => ({ ...prev, inclusive: e.target.checked }))}
                                            disabled={!taxSettings.enabled}
                                        />
                                        Total includes tax
                                    </label>
                                </div>
                                <div className="col-span-4">
                                    <label className="form-label">Tax Rate (%)</label>
                                    <Input
                                        type="number"
                                        value={taxSettings.rate}
                                        onChange={(e) => setTaxSettings(prev => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
                                        disabled={!taxSettings.enabled}
                                        inputClassName="text-sm h-8"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB CONTENT: ATTACHMENTS */}
                    {activeTab === 'attachments' && (
                        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 mb-4">
                            <div className="border-2 border-dashed border-neutral-300 rounded-xl bg-neutral-50 p-10 text-center transition-colors hover:bg-neutral-100 hover:border-neutral-400 flex flex-col items-center justify-center gap-3">
                                <Paperclip size={40} color="#bbb" className="text-neutral-400 mb-2" />
                                <h3 className="font-semibold text-neutral-700 m-0">Attachments</h3>
                                <button
                                    className="h-10 px-4 text-sm font-medium bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-md hover:bg-neutral-200 cursor-pointer"
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    Browse Files...
                                </button>
                                <input
                                    type="file"
                                    multiple
                                    ref={fileInputRef}
                                    className="hidden"
                                    onChange={handleFileUpload}
                                />
                            </div>

                            {formData.attachments.length > 0 && (
                                <div className="mt-6 pt-6 border-t border-neutral-200">
                                    <div className="grid grid-cols-12 gap-4">
                                        {formData.attachments.map((file) => (
                                            <div key={file.id} className="col-span-6 flex items-center gap-3 p-3 bg-neutral-0 border border-neutral-200 rounded-lg shadow-sm relative pr-10 hover:border-primary-300 transition-colors">
                                                <FileText size={24} color="var(--color-primary-600)" />
                                                <div className="flex-1 overflow-hidden">
                                                    <div className="font-semibold text-sm text-neutral-900 whitespace-nowrap overflow-hidden text-ellipsis mb-1">{file.name}</div>
                                                    <div className="text-xs text-neutral-500">{file.size}</div>
                                                </div>
                                                <button onClick={() => removeAttachment(file.id)} className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 text-neutral-400 cursor-pointer p-1 hover:text-danger-500 hover:bg-danger-50 rounded">
                                                    <X size={18} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </form>
        </FormPage>
    );
};

export default InvoiceForm;
