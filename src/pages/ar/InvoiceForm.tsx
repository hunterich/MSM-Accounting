import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { InventoryItem, Invoice, InvoiceLine } from '../../types';

interface InvoiceLineItem {
    id:          string;
    productId:   string;
    code:        string;
    description: string;
    quantity:    number;
    unit:        string;
    price:       number;
    discount:    number;
}

interface AttachmentItem {
    id:   string;
    name: string;
    size: string;
    type: string;
}

interface InvoiceFormData {
    id:              string;
    customerId:      string;
    email:           string;
    billingAddress:  string;
    shippingAddress: string;
    poNumber:        string;
    issueDate:       string;
    dueDate:         string;
    shippingDate:    string;
    number:          string;
    discount:        number;
    notes:           string;
    items:           InvoiceLineItem[];
    attachments:     AttachmentItem[];
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
    hasError:  boolean;
    errorInfo: Error | null;
}

interface InvoiceRouteState {
    mode?:             'create' | 'edit' | 'view';
    openInvoiceId?:    string;
    returnToWorkbench?: boolean;
    catalogState?: {
        searchTerm?: string;
        status?:     string;
        dateFrom?:   string;
        dateTo?:     string;
    };
}

type InvoiceTab = 'items' | 'info' | 'attachments';
type NumberingMode = 'auto' | 'manual';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { Printer, Save, Search, Info, Package, Paperclip, FileText, X } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';

import { useSettingsStore } from '../../stores/useSettingsStore';
import { useCustomers, useInvoices, useCreateInvoice, useUpdateInvoice } from '../../hooks/useAR';
import { useItems } from '../../hooks/useInventory';

const normalizeInvoiceLineItem = (line: InvoiceLine): InvoiceLineItem => ({
    id: String(line.id || line.itemId || `${Date.now()}-${Math.random()}`),
    productId: String(line.itemId || ''),
    code: line.code || String(line.itemId || line.id || ''),
    description: line.description || line.itemName || '',
    quantity: Number(line.quantity || 0),
    unit: line.unit || 'PCS',
    price: Number(line.price || 0),
    discount: Number(line.discount ?? line.discountPct ?? 0)
});

class TableErrorBoundary extends React.Component<TableErrorBoundaryProps, TableErrorBoundaryState> {
    constructor(props: TableErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, errorInfo: null };
    }
    static getDerivedStateFromError(error: Error): TableErrorBoundaryState { return { hasError: true, errorInfo: error }; }
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

const InvoiceForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const routeState = (location.state as InvoiceRouteState | null) || {};
    const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<InvoiceTab>('items');
    const [numberingMode, setNumberingMode] = useState<NumberingMode>('auto');
    const [selectedCustomerTerms, setSelectedCustomerTerms] = useState<number | null>(null);

    // Customer State
    const [masterCreditLimit, setMasterCreditLimit] = useState(5000000); // Mocked from Settings

    // Manage customers state dynamically
    const { data: customersData, isLoading: customersLoading } = useCustomers();
    const customerList = customersData?.data || [];
    const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();
    const invoices: Invoice[] = (invoicesData?.data || []).filter(Boolean);
    const { data: itemsData, isLoading: itemsLoading } = useItems();
    const products: InventoryItem[] = itemsData?.data || [];
    const createInvoice = useCreateInvoice();
    const updateInvoiceMutation = useUpdateInvoice();

    const [formData, setFormData] = useState<InvoiceFormData>({
        id: '',
        customerId: '',
        email: '',
        billingAddress: '',
        shippingAddress: '',
        poNumber: '',
        issueDate: new Date().toISOString().split('T')[0],
        dueDate: '',
        shippingDate: new Date().toISOString().split('T')[0],
        number: '',
        discount: 0,
        notes: '',
        items: [],
        attachments: [],
        currency: 'IDR',
        invoiceType: 'Sales Invoice'
    });
    const globalTaxSettings = useSettingsStore(s => s.taxSettings);
    const docNumbering = useSettingsStore(s => s.documentNumbering?.ar_invoice ?? { prefix: 'INV', resetPeriod: 'monthly', seqLength: 6 });

    const [taxSettings, setTaxSettings] = useState<InvoiceTaxSettings>({
        enabled: globalTaxSettings.enabled,
        inclusive: globalTaxSettings.inclusiveByDefault,
        rate: globalTaxSettings.defaultRate
    });



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
        if (routeState.openInvoiceId && routeState.mode === 'edit' && invoices.length > 0) {
            const exists = invoices.find((inv) => inv.id === routeState.openInvoiceId);
            if (exists) {
                setEditingInvoiceId(exists.id);
                setNumberingMode('manual');
                setFormData((prev) => ({
                    ...prev,
                    id: exists.id,
                    customerId: exists.customerId || '',
                    email: exists.email || '',
                    billingAddress: exists.billingAddress || '',
                    shippingAddress: exists.shippingAddress || '',
                    poNumber: exists.poNumber || '',
                    issueDate: exists.issueDate || prev.issueDate,
                    dueDate: exists.dueDate || '',
                    shippingDate: exists.shippingDate || prev.shippingDate,
                    number: exists.number || '',
                    discount: Number(exists.discountPct || 0),
                    notes: exists.notes || '',
                    items: (exists.items || exists.lines || []).map(normalizeInvoiceLineItem),
                    invoiceType: exists.invoiceType || prev.invoiceType,
                }));
                setActiveTab('items');
            }
        }
    }, [routeState.openInvoiceId, routeState.mode, invoices]);

    // Click outside to close item search range
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target;
            if (itemSearchRef.current && target instanceof Node && !itemSearchRef.current.contains(target)) {
                setShowItemResults(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleCustomerChange = (val: string) => {
        const custId = val;
        const customer = customerList.find((c) => c.id === custId);

        if (customer) {
            const issueDate = new Date(formData.issueDate);
            issueDate.setDate(issueDate.getDate() + (customer.paymentTerms || 30));
            const newDueDate = issueDate.toISOString().split('T')[0];

            setFormData((prev) => ({
                ...prev,
                customerId: custId,
                email: customer.email || '',
                billingAddress: customer.billingAddress || '',
                shippingAddress: customer.shippingAddress || '',
                discount: Number(customer.defaultDiscount || 0),
                dueDate: newDueDate
            }));
            setSelectedCustomerTerms(Number(customer.paymentTerms ?? 0));
        } else {
            setFormData((prev) => ({ ...prev, customerId: custId, email: '', billingAddress: '', shippingAddress: '' }));
            setSelectedCustomerTerms(null);
        }
    };

    const handleAddNewCustomer = () => {
        if (window.confirm("To add a new customer, you will be redirected to the Customer Form. Unsaved changes to this invoice will be lost. Continue?")) {
            navigate('/ar/customers/new');
        }
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = event.target;
        setFormData((prev) => ({
            ...prev,
            [name]: name === 'discount' ? Number(value) || 0 : value
        }));
    };

    // --- QUICK ADD ITEM LOGIC ---
    const filteredProducts = products.filter((product) =>
        product.name.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
        product.id.toLowerCase().includes(itemSearchTerm.toLowerCase())
    );

    const selectProduct = (product: InventoryItem) => {
        const newItem = {
            id: String(Date.now()),
            productId: product.id,
            code: product.code || product.sku || product.id,
            description: product.name,
            quantity: 1,
            unit: product.unit || 'PCS',
            price: product.price,
            discount: 0
        };

        setFormData((prev) => ({
            ...prev,
            items: [...prev.items, newItem]
        }));

        setItemSearchTerm('');
        setShowItemResults(false);
    };

    const addCustomItem = () => {
        const newItem = {
            id: String(Date.now()),
            productId: '',
            code: 'CUSTOM',
            description: itemSearchTerm,
            quantity: 1,
            unit: 'PCS',
            price: 0,
            discount: 0
        };

        setFormData((prev) => ({
            ...prev,
            items: [...prev.items, newItem]
        }));

        setItemSearchTerm('');
        setShowItemResults(false);
    };

    const removeItem = (id: string) => {
        setFormData((prev) => ({
            ...prev,
            items: prev.items.filter((item) => item.id !== id)
        }));
    };

    const handleItemChange = (id: string, field: keyof InvoiceLineItem, value: string | number) => {
        setFormData((prev) => {
            const newItems = prev.items.map((item) => {
                if (item.id === id) {
                    return { ...item, [field]: value };
                }
                return item;
            });
            return { ...prev, items: newItems };
        });
    };

    const calculateItemTotal = (item: InvoiceLineItem) => {
        const sub = item.quantity * item.price;
        const disc = sub * (item.discount / 100);
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

    const handleApprove = async () => {
        let assignedNo = formData.number;
        if (numberingMode === 'auto') {
            assignedNo = buildAutoNumber(formData.issueDate);
            setFormData((prev) => ({ ...prev, number: assignedNo }));
            setNextSequence((prev) => prev + 1);
        }

        const customerName = customerList.find((c) => c.id === formData.customerId)?.name || 'Unknown Customer';
        const finalInvoiceData = {
            ...formData,
            number: assignedNo,
            customerName,
            id: editingInvoiceId || formData.id || `INV-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
            status: editingInvoiceId
                ? (invoices.find((inv) => inv.id === editingInvoiceId)?.status || 'Draft')
                : 'Draft'
        };

        try {
            if (editingInvoiceId) {
                const { id: _finalId, ...invoicePayload } = finalInvoiceData;
                await updateInvoiceMutation.mutateAsync({ id: editingInvoiceId, ...invoicePayload });
            } else {
                await createInvoice.mutateAsync(finalInvoiceData);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            window.alert(`Failed to save invoice: ${message}`);
            return;
        }

        if (routeState.returnToWorkbench) {
            const targetInvoiceId = routeState.openInvoiceId || finalInvoiceData.id;
            const query = new URLSearchParams();
            const catalogState = routeState.catalogState || {};
            if (catalogState.searchTerm) query.set('search', catalogState.searchTerm);
            if (catalogState.status) query.set('status', catalogState.status);
            if (catalogState.dateFrom) query.set('from', catalogState.dateFrom);
            if (catalogState.dateTo) query.set('to', catalogState.dateTo);
            if (targetInvoiceId) query.set('invoiceId', targetInvoiceId);

            navigate(`/ar/invoices/workbench?${query.toString()}`, {
                state: {
                    invoiceId: targetInvoiceId,
                    catalogState,
                    updatedNumber: assignedNo
                }
            });
        }
    };

    const handlePrint = () => {
        window.print();
    };

    // Attachment Logic
    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        const newAttachments: AttachmentItem[] = files.map((file) => ({
            id: `${Date.now()}-${file.name}`,
            name: file.name,
            size: (file.size / 1024).toFixed(2) + ' KB',
            type: file.type
        }));

        setFormData((prev) => ({
            ...prev,
            attachments: [...prev.attachments, ...newAttachments]
        }));

        event.target.value = '';
    };

    const removeAttachment = (id: string) => {
        setFormData((prev) => ({
            ...prev,
            attachments: prev.attachments.filter((attachment) => attachment.id !== id)
        }));
    };

    // Prepare options for SearchableSelect
    const customerOptions = customerList.map((c) => ({
        value: c.id,
        label: c.name,
        subLabel: c.id
    }));

    const TabButton = ({ id, label, icon: Icon }: { id: InvoiceTab; label: string; icon: React.ComponentType<{ size?: number }> }) => (
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
        if (routeState.returnToWorkbench) {
            const query = new URLSearchParams();
            const catalogState = routeState.catalogState || {};
            if (catalogState.searchTerm) query.set('search', catalogState.searchTerm);
            if (catalogState.status) query.set('status', catalogState.status);
            if (catalogState.dateFrom) query.set('from', catalogState.dateFrom);
            if (catalogState.dateTo) query.set('to', catalogState.dateTo);
            if (routeState.openInvoiceId) query.set('invoiceId', routeState.openInvoiceId);
            navigate(`/ar/invoices/workbench?${query.toString()}`, {
                state: {
                    invoiceId: routeState.openInvoiceId || '',
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
            actions={(
                <>
                    <Button text="Print" variant="secondary" icon={<Printer size={16} />} onClick={handlePrint} />
                    <div className="w-[1px] h-8 bg-neutral-200 mx-1" />
                    <Button text="Save Draft" variant="secondary" disabled={isSaving} />
                    <Button text={isSaving ? 'Saving...' : 'Save & Approve'} variant="primary" icon={<Save size={16} />} onClick={handleApprove} disabled={isSaving} />
                </>
            )}
        >
            <form onSubmit={(e) => e.preventDefault()}>
                    {/* Header Section: compact single row */}
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4 mt-4 border-t-3 border-t-primary-500 mb-4">
                        <div className="grid grid-cols-12 gap-3">
                            {/* Customer */}
                            <div className="col-span-4">
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-sm font-semibold text-neutral-700">Customer *</label>
                                    <button
                                        type="button"
                                        className="text-xs font-medium text-primary-700 bg-transparent border-0 cursor-pointer hover:text-primary-800"
                                        onClick={handleAddNewCustomer}
                                    >
                                        New customer
                                    </button>
                                </div>
                                <SearchableSelect
                                    options={customerOptions}
                                    value={formData.customerId}
                                    onChange={handleCustomerChange}
                                    placeholder="Search & Select Customer..."
                                />
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
                                        onChange={(e) => setNumberingMode(e.target.value as NumberingMode)}
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
                                                    filteredProducts.map((p) => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => selectProduct(p)}
                                                            className="p-3 flex justify-between items-center cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 last:border-0"
                                                        >
                                                            <div>
                                                                <div className="font-semibold text-[0.95rem]">{p.name}</div>
                                                                <div className="text-xs text-neutral-500">{p.code} • Stock: 99+</div>
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
                                        ) : formData.items.map((item) => (
                                            <tr key={item.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                                                <td className="p-2 align-top">
                                                    <div className="text-xs font-semibold text-neutral-600 mb-1">{item.code}</div>
                                                    <input
                                                        value={item.description}
                                                        onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                                                        className="w-full text-sm border-0 bg-transparent p-0 m-0 focus:ring-0 text-neutral-900 placeholder-neutral-400"
                                                        placeholder="Description"
                                                    />
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
                                                        type="button"
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
                                                                onChange={(e) => setFormData((prev) => ({ ...prev, discount: parseFloat(e.target.value) || 0 }))}
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
                                            onChange={(e) => setTaxSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                                        />
                                        Apply Tax
                                    </label>
                                </div>
                                <div className="col-span-4">
                                    <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 select-none">
                                        <input
                                            type="checkbox"
                                            checked={taxSettings.inclusive}
                                            onChange={(e) => setTaxSettings((prev) => ({ ...prev, inclusive: e.target.checked }))}
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
                                        onChange={(e) => setTaxSettings((prev) => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
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
                                    type="button"
                                    className="h-10 px-4 text-sm font-medium bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-md hover:bg-neutral-200 cursor-pointer"
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
                                                <button type="button" onClick={() => removeAttachment(file.id)} className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 text-neutral-400 cursor-pointer p-1 hover:text-danger-500 hover:bg-danger-50 rounded">
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
