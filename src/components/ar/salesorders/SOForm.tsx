import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FormPage from '../../../components/Layout/FormPage';
import Input from '../../../components/UI/Input';
import Button from '../../../components/UI/Button';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import { formatIDR } from '../../../utils/formatters';
import { useCustomerStore } from '../../../stores/useCustomerStore';
import { useSalesOrderStore } from '../../../stores/useSalesOrderStore';
import { useCustomers } from '../../../hooks/useAR';
import { useItems } from '../../../hooks/useInventory';
import { Search, X, Package, Info, Save } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Customer shape used locally in the form.
 * Extends the fields present in both the store seed data and the API-normalised
 * Customer type, with an index signature to allow key-based merging.
 */
interface CustomerRecord {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    shippingAddress?: string;
    billingAddress?: string;
    address1?: string;
    city?: string;
    province?: string;
    [key: string]: unknown;
}

/**
 * Inventory item shape used locally in the form.
 * Superset of the API-normalised InventoryItem; index signature enables
 * property access via normalizedValue helpers.
 */
interface InvItem {
    id: string;
    name?: string;
    code?: string;
    sku?: string;
    description?: string;
    unit?: string;
    sellUnit?: string;
    price?: number;
    currentStock?: number;
    stock?: number;
    [key: string]: unknown;
}

/** A single editable line item in the form. */
interface LineItem {
    id: string;
    productId: string;
    code: string;
    description: string;
    qty: number;
    unit: string;
    price: number;
    discount: number;
}

type SOStatus = 'Draft' | 'Confirmed' | 'Delivered' | 'Invoiced' | 'Closed';

/** The form's header / metadata fields. */
interface SOFormData {
    customerId: string;
    customerName: string;
    date: string;
    expectedDate: string;
    status: SOStatus;
    currency: string;
    notes: string;
    shippingAddress: string;
    deliveryNotes: string;
}

/** Validation error bag. */
type FormErrors = Partial<Record<keyof SOFormData | 'lineItems', string | null>>;

interface SOFormProps {
    mode?: 'create' | 'edit';
}

// ── Constants / helpers ───────────────────────────────────────────────────────

const todayString = (): string => new Date().toISOString().slice(0, 10);

const emptyForm: SOFormData = {
    customerId: '',
    customerName: '',
    date: todayString(),
    expectedDate: '',
    status: 'Draft',
    currency: 'IDR',
    notes: '',
    shippingAddress: '',
    deliveryNotes: '',
};

/** Fields that should stay as strings rather than be cast to numbers. */
const textFields = new Set<string>(['productId', 'code', 'description', 'unit']);

const makeLineId = (): string => `li-${Date.now()}-${Math.round(Math.random() * 1000)}`;

/**
 * Deep-merge arrays of objects by `id`, with later groups winning on
 * conflicting keys.
 */
const mergeById = (...groups: Array<CustomerRecord[] | undefined | null>): CustomerRecord[] => {
    const byId = new Map<string, CustomerRecord>();
    groups
        .flat()
        .filter((item): item is CustomerRecord => Boolean(item))
        .forEach((item) => {
            if (!item?.id) return;
            byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item });
        });
    return Array.from(byId.values());
};

/** Normalise a value to a trimmed lowercase string for case-insensitive matching. */
const normalizedValue = (value: unknown): string =>
    String(value || '').trim().toLowerCase();

/**
 * Build a shipping address string from a customer record, falling back from
 * explicit address fields to address components.
 */
const buildShippingAddress = (customer: CustomerRecord | undefined | null): string => {
    if (!customer) return '';

    const directAddress = [customer.shippingAddress, customer.billingAddress]
        .map((value) => String(value || '').trim())
        .find(Boolean);

    if (directAddress) return directAddress;

    return [customer.address1, customer.city, customer.province]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(', ');
};

const calculateLineTotal = (line: LineItem): number => {
    const qty = Number(line.qty || 0);
    const price = Number(line.price || 0);
    const discount = Number(line.discount || 0);
    const gross = qty * price;
    return gross - gross * (discount / 100);
};

const buildInitialForm = (salesOrder: Record<string, unknown> | null | undefined): SOFormData => {
    if (!salesOrder) return emptyForm;

    return {
        customerId: (salesOrder.customerId as string) || '',
        customerName: (salesOrder.customerName as string) || '',
        date: (salesOrder.date as string) || todayString(),
        expectedDate: (salesOrder.expectedDate as string) || '',
        status: ((salesOrder.status as SOStatus) || 'Draft') as SOStatus,
        currency: (salesOrder.currency as string) || 'IDR',
        notes: (salesOrder.notes as string) || '',
        shippingAddress: (salesOrder.shippingAddress as string) || '',
        deliveryNotes: (salesOrder.deliveryNotes as string) || '',
    };
};

// ── Component ─────────────────────────────────────────────────────────────────

const SOForm: React.FC<SOFormProps> = ({ mode = 'create' }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const soId = searchParams.get('soId') || '';

    // Stores & hooks
    const seedCustomers = (useCustomerStore((s) => s.customers) as CustomerRecord[]) || [];
    const { data: customersResult } = useCustomers({ limit: 100 });
    const { data: itemsResult } = useItems({ limit: 100 });

    const salesOrders = useSalesOrderStore((s) => s.salesOrders);
    const soItemTemplates = useSalesOrderStore((s) => s.soItemTemplates);
    const addSalesOrder = useSalesOrderStore((s) => s.addSalesOrder);
    const updateSalesOrder = useSalesOrderStore((s) => s.updateSalesOrder);
    const setSoItemTemplates = useSalesOrderStore((s) => s.setSoItemTemplates);

    const selectedSalesOrder = useMemo(
        () => salesOrders.find((so) => so.id === soId) || null,
        [salesOrders, soId],
    );

    const [formData, setFormData] = useState<SOFormData>(() => buildInitialForm(selectedSalesOrder as unknown as Record<string, unknown>));
    const [lineItems, setLineItems] = useState<LineItem[]>(() => {
        if (!selectedSalesOrder) return [];
        return (soItemTemplates[selectedSalesOrder.id] || []).map((line) => ({
            ...line,
            id: (line as { id?: string }).id || makeLineId(),
        })) as LineItem[];
    });
    const [errors, setErrors] = useState<FormErrors>({});
    const [activeTab, setActiveTab] = useState<'items' | 'info'>('items');
    const [itemSearchTerm, setItemSearchTerm] = useState<string>('');
    const [showItemResults, setShowItemResults] = useState<boolean>(false);
    const itemSearchRef = useRef<HTMLDivElement>(null);

    const customers = useMemo<CustomerRecord[]>(
        () => mergeById(seedCustomers, (customersResult?.data as unknown as CustomerRecord[]) || []),
        [seedCustomers, customersResult?.data],
    );
    const inventoryItems = useMemo<InvItem[]>(
        () => (itemsResult?.data as unknown as InvItem[]) || [],
        [itemsResult?.data],
    );

    useEffect(() => {
        setFormData(buildInitialForm(selectedSalesOrder as unknown as Record<string, unknown>));

        if (selectedSalesOrder) {
            const lines = (soItemTemplates[selectedSalesOrder.id] || []).map((line) => ({
                ...line,
                id: (line as { id?: string }).id || makeLineId(),
            })) as LineItem[];
            setLineItems(lines);
        } else {
            setLineItems([]);
        }

        setErrors({});
    }, [selectedSalesOrder, soItemTemplates]);

    useEffect(() => {
        if (!formData.customerId || formData.shippingAddress?.trim()) return;

        const customer = customers.find((item) => item.id === formData.customerId);
        const nextAddress = buildShippingAddress(customer);
        if (!nextAddress) return;

        setFormData((prev) =>
            prev.customerId === formData.customerId && !prev.shippingAddress?.trim()
                ? { ...prev, shippingAddress: nextAddress }
                : prev,
        );
    }, [customers, formData.customerId, formData.shippingAddress]);

    const customerOptions = useMemo(
        () =>
            customers.map((customer) => ({
                value: customer.id,
                label: (customer.name as string) || (customer.code as string) || '',
                subLabel: (customer.email as string) || (customer.phone as string) || (customer.code as string) || '',
            })),
        [customers],
    );

    const filteredProducts = useMemo<InvItem[]>(() => {
        const term = normalizedValue(itemSearchTerm);
        if (!term) return [];

        return inventoryItems
            .filter(
                (item) =>
                    normalizedValue(item.name).includes(term) ||
                    normalizedValue(item.code).includes(term) ||
                    normalizedValue(item.sku).includes(term) ||
                    normalizedValue(item.description).includes(term),
            )
            .slice(0, 8);
    }, [itemSearchTerm, inventoryItems]);

    const totalAmount = useMemo<number>(
        () => lineItems.reduce((sum, line) => sum + calculateLineTotal(line), 0),
        [lineItems],
    );

    const handleCustomerChange = (customerId: string): void => {
        const customer = customers.find((item) => item.id === customerId);
        const nextShippingAddress = buildShippingAddress(customer);
        setFormData((prev) => ({
            ...prev,
            customerId,
            customerName: (customer?.name as string) || '',
            shippingAddress: nextShippingAddress,
        }));
        setErrors((prev) => ({ ...prev, customerId: null }));
    };

    const handleChange = (key: keyof SOFormData, value: string): void => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: null }));
    };

    const handleLineChange = (lineId: string, key: keyof LineItem, value: string | number): void => {
        setLineItems((prev) =>
            prev.map((line) =>
                line.id === lineId
                    ? {
                          ...line,
                          [key]: textFields.has(key) ? String(value) : Number(value || 0),
                      }
                    : line,
            ),
        );
    };

    const selectProduct = (item: InvItem): void => {
        setLineItems((prev) => [
            ...prev,
            {
                id: makeLineId(),
                productId: item.id || '',
                code: item.code || item.sku || '',
                description: String(item.name || item.description || ''),
                qty: 1,
                unit: item.sellUnit || item.unit || 'PCS',
                price: Number(item.price || 0),
                discount: 0,
            },
        ]);
        setItemSearchTerm('');
        setShowItemResults(false);
        setErrors((prev) => ({ ...prev, lineItems: null }));
    };

    const addCustomItem = (): void => {
        if (!itemSearchTerm.trim()) return;
        setLineItems((prev) => [
            ...prev,
            {
                id: makeLineId(),
                productId: '',
                code: '',
                description: itemSearchTerm.trim(),
                qty: 1,
                unit: 'PCS',
                price: 0,
                discount: 0,
            },
        ]);
        setItemSearchTerm('');
        setShowItemResults(false);
        setErrors((prev) => ({ ...prev, lineItems: null }));
    };

    const handleRemoveLine = (lineId: string): void => {
        setLineItems((prev) => prev.filter((line) => line.id !== lineId));
    };

    const validate = (): FormErrors => {
        const nextErrors: FormErrors = {};

        if (!formData.customerId) nextErrors.customerId = 'Customer is required.';
        if (!formData.date) nextErrors.date = 'Order date is required.';
        if (!formData.expectedDate) nextErrors.expectedDate = 'Expected delivery date is required.';

        const validLines = lineItems.filter((line) => line.description.trim());
        if (validLines.length === 0) nextErrors.lineItems = 'At least one line item is required.';

        if (validLines.some((line) => Number(line.qty || 0) <= 0)) {
            nextErrors.lineItems = 'Line qty must be greater than 0.';
        }

        return nextErrors;
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();

        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            if (nextErrors.lineItems) setActiveTab('items');
            return;
        }

        const cleanedLines = lineItems
            .filter((line) => line.description.trim())
            .map((line) => ({
                id: line.id,
                productId: line.productId || undefined,
                code: line.code || undefined,
                description: line.description.trim(),
                qty: Number(line.qty || 0),
                unit: line.unit || 'PCS',
                price: Number(line.price || 0),
                discount: Number(line.discount || 0),
            }));

        const payload = {
            customerId: formData.customerId,
            customerName: formData.customerName,
            date: formData.date,
            expectedDate: formData.expectedDate,
            status: formData.status,
            currency: formData.currency,
            amount: totalAmount,
            notes: formData.notes,
            shippingAddress: formData.shippingAddress,
            deliveryNotes: formData.deliveryNotes,
            convertedInvoiceId: selectedSalesOrder?.convertedInvoiceId ?? null,
        };

        if (mode === 'edit' && selectedSalesOrder) {
            await updateSalesOrder(selectedSalesOrder.id, payload);
            await setSoItemTemplates(selectedSalesOrder.id, cleanedLines as Parameters<typeof setSoItemTemplates>[1]);
        } else {
            const created = await addSalesOrder(payload);
            await setSoItemTemplates(created.id, cleanedLines as Parameters<typeof setSoItemTemplates>[1]);
        }

        navigate('/ar/sales-orders');
    };

    const isEditMode = mode === 'edit';

    const TabButton = ({ id, label, icon: Icon }: { id: 'items' | 'info'; label: string; icon: React.ComponentType<{ size?: number }> }) => (
        <button
            type="button"
            className={`inline-flex items-center gap-2 py-2.5 px-3.5 border border-transparent border-b-2 bg-transparent font-semibold text-sm cursor-pointer transition-colors ${activeTab === id ? 'text-primary-700 border-b-primary-600' : 'text-neutral-600 border-b-transparent hover:text-neutral-900'}`}
            onClick={() => setActiveTab(id)}
        >
            <span className="flex items-center"><Icon size={14} /></span>
            {label}
        </button>
    );

    return (
        <FormPage
            containerClassName="ar-module sales-order-form"
            title={isEditMode ? `Edit Sales Order${soId ? ` ${soId}` : ''}` : 'Sales Order'}
            backTo="/ar/sales-orders"
            backLabel="Back"
            actions={(
                <>
                    <Button text="Cancel" variant="secondary" onClick={() => navigate('/ar/sales-orders')} />
                    <Button
                        text={isEditMode ? 'Update Sales Order' : 'Save Sales Order'}
                        variant="primary"
                        icon={<Save size={16} />}
                        type="submit"
                        form="sales-order-form-main"
                    />
                </>
            )}
        >
            <form id="sales-order-form-main" onSubmit={handleSubmit}>
                {isEditMode && soId && !selectedSalesOrder ? (
                    <div className="journal-warning-banner mt-4">
                        Sales Order `{soId}` not found. Create a new order instead.
                    </div>
                ) : null}

                {/* Header Section: compact single row */}
                <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-4 mt-4 border-t-3 border-t-primary-500 mb-4">
                    <div className="grid grid-cols-12 gap-3">
                        {/* Customer */}
                        <div className="col-span-4">
                            <SearchableSelect
                                label="Customer *"
                                options={customerOptions}
                                value={formData.customerId}
                                onChange={handleCustomerChange}
                                placeholder="Search & Select Customer..."
                            />
                            {errors.customerId ? <div className="w-full -mt-2 mb-2 text-xs text-danger-500">{errors.customerId}</div> : null}
                        </div>
                        {/* Order Date */}
                        <div className="col-span-2">
                            <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Order Date *</label>
                            <Input
                                type="date"
                                value={formData.date}
                                onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleChange('date', event.target.value)}
                                error={errors.date}
                            />
                        </div>
                        {/* Expected Delivery */}
                        <div className="col-span-2">
                            <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Expected Delivery *</label>
                            <Input
                                type="date"
                                value={formData.expectedDate}
                                onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleChange('expectedDate', event.target.value)}
                                error={errors.expectedDate}
                            />
                        </div>
                        {/* Status */}
                        <div className="col-span-2">
                            <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Status</label>
                            <select
                                className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                value={formData.status}
                                onChange={(event) => handleChange('status', event.target.value as SOStatus)}
                            >
                                <option value="Draft">Draft</option>
                                <option value="Confirmed">Confirmed</option>
                                <option value="Delivered">Delivered</option>
                                <option value="Invoiced">Invoiced</option>
                                <option value="Closed">Closed</option>
                            </select>
                        </div>
                        {/* Currency */}
                        <div className="col-span-2">
                            <label className="block mb-1.5 text-sm font-semibold text-neutral-700">Currency</label>
                            <select
                                className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                value={formData.currency}
                                onChange={(event) => handleChange('currency', event.target.value)}
                            >
                                <option value="IDR">IDR</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* TABS Navigation */}
                <div className="flex gap-2 border-b border-neutral-200 bg-neutral-0 px-2">
                    <TabButton id="items" label="Item Details" icon={Package} />
                    <TabButton id="info" label="Logistics & Notes" icon={Info} />
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
                                        onChange={(event) => {
                                            setItemSearchTerm(event.target.value);
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
                                                            <div className="text-xs text-neutral-500">{p.code || p.sku} • Stock: {(p.currentStock ?? p.stock ?? 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="font-bold text-success-600">
                                                            {formatIDR(p.price ?? 0)}
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div
                                                    onClick={addCustomItem}
                                                    className="p-3 cursor-pointer text-primary-600 text-center hover:bg-primary-50"
                                                >
                                                    <b>+ Add &quot;{itemSearchTerm}&quot;</b> as a new line item
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
                                    {lineItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="text-center p-8 border-b border-neutral-100">
                                                <div className="text-neutral-500 font-medium mb-1">No items added</div>
                                                <div className="text-neutral-400 text-xs">Use the search bar above to add products</div>
                                            </td>
                                        </tr>
                                    ) : lineItems.map((line) => (
                                        <tr key={line.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                                            <td className="p-2 align-top">
                                                {line.code ? <div className="text-xs font-semibold text-neutral-600 mb-1">{line.code}</div> : null}
                                                <input
                                                    value={line.description}
                                                    onChange={(event) => handleLineChange(line.id, 'description', event.target.value)}
                                                    className="w-full text-sm border-0 bg-transparent p-0 m-0 focus:ring-0 text-neutral-900 placeholder-neutral-400"
                                                    placeholder="Description"
                                                />
                                            </td>
                                            <td className="p-2 align-top">
                                                <Input
                                                    type="number"
                                                    value={line.qty}
                                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleLineChange(line.id, 'qty', Number(event.target.value))}
                                                    inputClassName="text-sm h-8 text-center"
                                                />
                                            </td>
                                            <td className="p-2 align-top">
                                                <Input
                                                    type="text"
                                                    value={line.unit}
                                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleLineChange(line.id, 'unit', event.target.value)}
                                                    inputClassName="text-sm h-8 text-center"
                                                />
                                            </td>
                                            <td className="p-2 align-top">
                                                <Input
                                                    type="number"
                                                    value={line.price}
                                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleLineChange(line.id, 'price', Number(event.target.value))}
                                                    inputClassName="text-sm h-8 text-right"
                                                />
                                            </td>
                                            <td className="p-2 align-top">
                                                <Input
                                                    type="number"
                                                    value={line.discount}
                                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleLineChange(line.id, 'discount', Number(event.target.value))}
                                                    inputClassName="text-sm h-8 text-right"
                                                />
                                            </td>
                                            <td className="p-2 align-top text-right font-bold text-neutral-800 pt-3.5">
                                                {formatIDR(calculateLineTotal(line))}
                                            </td>
                                            <td className="p-2 align-top text-center pt-3">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveLine(line.id)}
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

                            {errors.lineItems ? <div className="px-4 py-2 text-xs text-danger-500">{errors.lineItems}</div> : null}
                        </div>

                        {/* Footer Section: Totals Aligned to Right */}
                        <div className="flex justify-end mt-4">
                            <div className="w-[320px]">
                                <div className="bg-neutral-0 border border-neutral-200 rounded-lg shadow-sm flex flex-col h-full p-4">
                                    <div className="flex justify-between items-center mb-2 text-sm text-neutral-600">
                                        <span>Subtotal</span>
                                        <span>{formatIDR(totalAmount)}</span>
                                    </div>
                                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-neutral-200">
                                        <span className="font-bold text-neutral-900 text-lg">Total</span>
                                        <span className="font-bold text-primary-700 text-xl">{formatIDR(totalAmount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* TAB CONTENT: LOGISTICS & NOTES */}
                {activeTab === 'info' && (
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 mb-4">
                        <div className="grid grid-cols-12 gap-5 mb-5">
                            <div className="col-span-6">
                                <label className="block mb-2 text-sm font-semibold text-neutral-700">Shipping Address</label>
                                <textarea
                                    className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] resize-y"
                                    rows={4}
                                    value={formData.shippingAddress}
                                    onChange={(event) => handleChange('shippingAddress', event.target.value)}
                                />
                            </div>
                            <div className="col-span-6">
                                <label className="block mb-2 text-sm font-semibold text-neutral-700">Delivery Notes</label>
                                <textarea
                                    className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] resize-y"
                                    rows={4}
                                    value={formData.deliveryNotes}
                                    onChange={(event) => handleChange('deliveryNotes', event.target.value)}
                                />
                            </div>
                        </div>

                        <div className="h-[1px] bg-neutral-200 my-6"></div>

                        <div className="grid grid-cols-12 gap-4">
                            <div className="col-span-12">
                                <label className="form-label">Internal Notes</label>
                                <textarea
                                    className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] resize-y"
                                    rows={2}
                                    value={formData.notes}
                                    onChange={(event) => handleChange('notes', event.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </form>
        </FormPage>
    );
};

export default SOForm;
