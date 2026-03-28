import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { useItems, useCreateItem, useUpdateItem, useItemCategories, useNextItemSku } from '../../hooks/useInventory';
import { useChartOfAccounts } from '../../hooks/useGL';

// ─── Types ──────────────────────────────────────────────────────────────────

import { inventorySchema, zodToFormErrors } from '../../utils/formSchemas';

interface SelectFieldProps {
    label?:    string;
    name:      string;
    value:     string;
    onChange:  React.ChangeEventHandler<HTMLSelectElement>;
    error?:    string | null;
    disabled?: boolean;
    children:  React.ReactNode;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ITEM_TYPES = ['Product', 'Service', 'Raw Material', 'Consumable', 'Fixed Asset'];

const UNITS = ['PCS', 'BOX', 'KG', 'GRAM', 'LITER', 'METER', 'HOUR', 'DAY', 'SET', 'UNIT', 'CARTON', 'DOZEN', 'STRIP', 'TABLET', 'SACHET', 'BOTTLE', 'PACK'];

const DEFAULT_INVENTORY_ACCOUNT = 'COA-1310';
const DEFAULT_REVENUE_ACCOUNT   = 'COA-4100';
const DEFAULT_COGS_ACCOUNT      = 'COA-5100';

const INVENTORY_ITEM_SEED = [
    { id: 'SKU-001', name: 'MacBook Pro 16"', category: 'Hardware', stock: 15, cost: 22000000, price: 25000000, status: 'In Stock' },
    { id: 'SKU-002', name: 'Dell XPS 13', category: 'Hardware', stock: 4, cost: 9000000, price: 12000000, status: 'Low Stock' },
    { id: 'SKU-003', name: 'USB-C Cable', category: 'Accessories', stock: 150, cost: 50000, price: 150000, status: 'In Stock' },
    { id: 'SKU-004', name: 'Monitor Stand', category: 'Accessories', stock: 0, cost: 250000, price: 450000, status: 'Out of Stock' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

const SelectField = ({ label, name, value, onChange, error, disabled, children }) => (
    <div>
        {label && <label className="form-label">{label}</label>}
        <select
            className={`w-full h-10 px-3 rounded-md border bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed ${error ? 'border-danger-500' : 'border-neutral-300'}`}
            name={name}
            value={value}
            onChange={onChange}
            disabled={disabled}
        >
            {children}
        </select>
        {error && <div className="form-feedback invalid-feedback">{error}</div>}
    </div>
);

const buildItemState = (item) => {
    if (!item) {
        return {
            sku:                '',
            skuManuallyEdited:  false,
            name:               '',
            categoryId:         '',
            type:               'Product',
            unit:               'PCS',
            purchaseUnit:       '',
            purchaseConversionFactor: '',
            sellUnit:           '',
            sellConversionFactor:     '',
            cost:               '',
            price:              '',
            openingStock:       '0',
            reorderPoint:       '5',
            inventoryAccountId: DEFAULT_INVENTORY_ACCOUNT,
            revenueAccountId:   DEFAULT_REVENUE_ACCOUNT,
            cogsAccountId:      DEFAULT_COGS_ACCOUNT,
            description:        '',
            barcode:            '',
            weight:             '',
            status:             'Active',
        };
    }
    return {
        sku:                item.sku || item.id || '',
        skuManuallyEdited:  true,
        name:               item.name || '',
        categoryId:         item.categoryId || '',
        type:               item.type || 'Product',
        unit:               item.unit || 'PCS',
        purchaseUnit:       item.purchaseUnit || '',
        purchaseConversionFactor: item.purchaseConversionFactor != null ? String(item.purchaseConversionFactor) : '',
        sellUnit:           item.sellUnit || '',
        sellConversionFactor:     item.sellConversionFactor != null ? String(item.sellConversionFactor) : '',
        cost:               item.cost != null ? String(item.cost) : '',
        price:              item.price != null ? String(item.price) : '',
        openingStock:       item.openingStock != null ? String(item.openingStock) : item.stock != null ? String(item.stock) : '0',
        reorderPoint:       item.reorderPoint != null ? String(item.reorderPoint) : '5',
        inventoryAccountId: item.inventoryAccountId || DEFAULT_INVENTORY_ACCOUNT,
        revenueAccountId:   item.revenueAccountId   || DEFAULT_REVENUE_ACCOUNT,
        cogsAccountId:      item.cogsAccountId      || DEFAULT_COGS_ACCOUNT,
        description:        item.description || '',
        barcode:            item.barcode     || '',
        weight:             item.weight      || '',
        status:             item.status === 'Out of Stock' ? 'Active' : (item.status || 'Active'),
    };
};

// ─── Component ─────────────────────────────────────────────────────────────

const InventoryForm = () => {
    const navigate        = useNavigate();
    const location        = useLocation();
    const [searchParams]  = useSearchParams();

    const createItem   = useCreateItem();
    const updateItem   = useUpdateItem();
    const nextSkuMut   = useNextItemSku();
    const { data: itemsData, isLoading: itemsLoading } = useItems();
    const { data: itemCategories = [], isLoading: categoriesLoading } = useItemCategories();
    const storeProducts = itemsData?.data ?? [];

    const itemId   = searchParams.get('itemId') || '';
    const rawMode  = searchParams.get('mode') || 'create';
    const mode     = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'create';
    const isViewMode = mode === 'view';

    const isSaving = createItem.isPending || updateItem.isPending;

    const selectedItem = useMemo(() => {
        const stateItem = location.state?.item;
        if (stateItem && (!itemId || stateItem.id === itemId)) return stateItem;
        if (!itemId) return null;
        return storeProducts.find((p) => p.id === itemId)
            || INVENTORY_ITEM_SEED.find((item) => item.id === itemId)
            || null;
    }, [itemId, location.state, storeProducts]);

    const [formData, setFormData] = useState(() => buildItemState(selectedItem));
    const [errors, setErrors]     = useState({});

    useEffect(() => {
        setFormData(buildItemState(selectedItem));
        setErrors({});
    }, [itemId, mode, selectedItem]);

    // ── Account lists ─────────────────────────────────────────────────────
    const { data: allAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const inventoryAccounts = useMemo(() => allAccounts.filter((a) => a.isActive && a.isPostable && a.type === 'Asset'), [allAccounts]);
    const revenueAccounts   = useMemo(() => allAccounts.filter((a) => a.isActive && a.isPostable && a.type === 'Revenue'), [allAccounts]);
    const cogsAccounts      = useMemo(() => allAccounts.filter((a) => a.isActive && a.isPostable && a.type === 'Expense'), [allAccounts]);

    // Computed margin
    const margin = useMemo(() => {
        const cost  = Number(formData.cost)  || 0;
        const price = Number(formData.price) || 0;
        if (!price) return null;
        const pct = ((price - cost) / price) * 100;
        return { amount: price - cost, pct: pct.toFixed(1) };
    }, [formData.cost, formData.price]);

    // ── Handlers ──────────────────────────────────────────────────────────
    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev)    => ({ ...prev, [name]: null }));
    };

    const handleSkuChange = (e) => {
        setFormData((prev) => ({ ...prev, sku: e.target.value, skuManuallyEdited: true }));
        setErrors((prev)   => ({ ...prev, sku: null }));
    };

    const handleCategoryChange = async (e) => {
        const categoryId = e.target.value;
        setFormData((prev) => ({ ...prev, categoryId }));
        setErrors((prev)   => ({ ...prev, categoryId: null }));

        // Auto-generate SKU if not manually edited (create mode only)
        if (mode === 'create' && !formData.skuManuallyEdited && categoryId) {
            try {
                const result = await nextSkuMut.mutateAsync(categoryId);
                setFormData((prev) => ({ ...prev, categoryId, sku: result.sku || prev.sku }));
            } catch {
                // silently ignore — user can type SKU manually
            }
        }
    };

    const handleSave = async () => {
        const result = inventorySchema.safeParse(formData);
        if (!result.success) { setErrors(zodToFormErrors(result.error)); return; }

        const payload = {
            sku:                formData.sku.trim(),
            name:               formData.name.trim(),
            categoryId:         formData.categoryId || null,
            type:               formData.type,
            unit:               formData.unit,
            purchaseUnit:       formData.purchaseUnit || null,
            purchaseConversionFactor: formData.purchaseUnit && formData.purchaseConversionFactor ? Number(formData.purchaseConversionFactor) : null,
            sellUnit:           formData.sellUnit || null,
            sellConversionFactor: formData.sellUnit && formData.sellConversionFactor ? Number(formData.sellConversionFactor) : null,
            cost:               Number(formData.cost),
            price:              Number(formData.price),
            openingStock:       Number(formData.openingStock),
            reorderPoint:       Number(formData.reorderPoint),
            inventoryAccountId: formData.inventoryAccountId,
            revenueAccountId:   formData.revenueAccountId,
            cogsAccountId:      formData.cogsAccountId,
            description:        formData.description,
            barcode:            formData.barcode,
            weight:             formData.weight,
            status:             formData.status,
        };

        try {
            if (mode === 'edit' && itemId) {
                await updateItem.mutateAsync({ id: itemId, ...payload });
            } else {
                await createItem.mutateAsync(payload);
            }
            navigate('/inventory');
        } catch (err) {
            alert(`Failed to save item: ${err?.message ?? 'Unknown error'}`);
        }
    };

    const pageTitle = isViewMode
        ? `View Item${itemId ? ` — ${itemId}` : ''}`
        : mode === 'edit'
        ? `Edit Item${itemId ? ` — ${itemId}` : ''}`
        : 'New Inventory Item';

    const isPageLoading = itemsLoading || chartOfAccountsLoading || categoriesLoading;

    const selectedCategory = itemCategories.find((c) => c.id === formData.categoryId);

    // Units available for purchase/sell (exclude base unit)
    const otherUnits = UNITS.filter((u) => u !== formData.unit);

    return (
        <FormPage
            containerClassName="inventory-module"
            title={pageTitle}
            backTo="/inventory"
            backLabel="Back to Inventory"
            isLoading={isPageLoading}
            actions={
                isViewMode ? (
                    <Button text="Close" variant="primary" onClick={() => navigate('/inventory')} />
                ) : (
                    <>
                        <Button text="Cancel" variant="secondary" onClick={() => navigate('/inventory')} disabled={isSaving} />
                        <Button
                            text={isSaving ? 'Saving...' : mode === 'edit' ? 'Update Item' : 'Save Item'}
                            variant="primary"
                            onClick={handleSave}
                            disabled={isSaving}
                        />
                    </>
                )
            }
        >

            {/* ── Item Details ──────────────────────────────────────────── */}
            <div className="invoice-panel panel-primary-top">
                <div className="invoice-panel-header">
                    <span className="invoice-panel-title">Item Details</span>
                </div>

                <div className="grid-12 form-grid-start">
                    {/* Row 1: Name(5) SKU(3) Barcode(4) */}
                    <div className="col-span-5">
                        <Input
                            label="Item Name *"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder='e.g. MacBook Pro 16"'
                            error={errors.name}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="SKU / Item Code *"
                            name="sku"
                            value={formData.sku}
                            onChange={handleSkuChange}
                            placeholder="Auto-generated or type manually"
                            error={errors.sku}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Barcode / GTIN"
                            name="barcode"
                            value={formData.barcode}
                            onChange={handleChange}
                            placeholder="Optional — scan or type"
                            disabled={isViewMode}
                        />
                    </div>

                    {/* Row 2: Category(4) Type(3) Unit(2) Status(3) */}
                    <div className="col-span-4">
                        <div>
                            <label className="form-label">
                                Category *
                                {selectedCategory && (
                                    <span className="inventory-category-badge">{selectedCategory.name}</span>
                                )}
                            </label>
                            <select
                                className={`w-full h-10 px-3 rounded-md border bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 ${errors.categoryId ? 'border-danger-500' : 'border-neutral-300'}`}
                                value={formData.categoryId}
                                onChange={handleCategoryChange}
                                disabled={isViewMode}
                            >
                                <option value="">— Select Category —</option>
                                {itemCategories.filter((c) => c.isActive).map((cat) => (
                                    <option key={cat.id} value={cat.id}>{cat.code} — {cat.name}</option>
                                ))}
                            </select>
                            {errors.categoryId && <div className="form-feedback invalid-feedback">{errors.categoryId}</div>}
                            {!isViewMode && itemCategories.length === 0 && !categoriesLoading && (
                                <p className="text-xs text-amber-600 mt-1">No categories yet — <a href="/inventory/categories" className="underline">create one first</a>.</p>
                            )}
                        </div>
                    </div>

                    <div className="col-span-3">
                        <SelectField label="Item Type" name="type" value={formData.type} onChange={handleChange} disabled={isViewMode}>
                            {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-2">
                        <SelectField label="Base Unit" name="unit" value={formData.unit} onChange={handleChange} disabled={isViewMode}>
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-3">
                        <SelectField label="Status" name="status" value={formData.status} onChange={handleChange} disabled={isViewMode}>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive (Hidden from sales)</option>
                        </SelectField>
                    </div>

                    {/* Row 3: Description */}
                    <div className="col-span-12">
                        <Input
                            label="Description"
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            placeholder="Optional — appears on invoices and purchase orders"
                            disabled={isViewMode}
                        />
                    </div>
                </div>
            </div>

            {/* ── Unit Conversion ───────────────────────────────────────── */}
            <div className="invoice-panel">
                <div className="invoice-panel-header">
                    <div>
                        <span className="invoice-panel-title">Unit Conversion</span>
                        <span className="invoice-panel-subtitle"> — optional reference for stock calculation</span>
                    </div>
                </div>

                <div className="grid-12 form-grid-start">
                    {/* Purchase unit */}
                    <div className="col-span-3">
                        <SelectField label="Purchase Unit" name="purchaseUnit" value={formData.purchaseUnit} onChange={handleChange} disabled={isViewMode}>
                            <option value="">— None —</option>
                            {otherUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-3">
                        <Input
                            label={`1 ${formData.purchaseUnit || 'purchase unit'} = ? ${formData.unit}`}
                            name="purchaseConversionFactor"
                            type="number"
                            value={formData.purchaseConversionFactor}
                            onChange={handleChange}
                            placeholder="e.g. 12"
                            error={errors.purchaseConversionFactor}
                            disabled={isViewMode || !formData.purchaseUnit}
                        />
                    </div>
                    <div className="col-span-6 flex items-end pb-1">
                        {formData.purchaseUnit && formData.purchaseConversionFactor && Number(formData.purchaseConversionFactor) > 0 && (
                            <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2">
                                1 <strong>{formData.purchaseUnit}</strong> = {formData.purchaseConversionFactor} <strong>{formData.unit}</strong>
                                {' '}· 10 {formData.purchaseUnit} = {10 * Number(formData.purchaseConversionFactor)} {formData.unit}
                            </p>
                        )}
                    </div>

                    {/* Sell unit */}
                    <div className="col-span-3">
                        <SelectField label="Sell Unit" name="sellUnit" value={formData.sellUnit} onChange={handleChange} disabled={isViewMode}>
                            <option value="">— None —</option>
                            {otherUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-3">
                        <Input
                            label={`1 ${formData.sellUnit || 'sell unit'} = ? ${formData.unit}`}
                            name="sellConversionFactor"
                            type="number"
                            value={formData.sellConversionFactor}
                            onChange={handleChange}
                            placeholder="e.g. 10"
                            error={errors.sellConversionFactor}
                            disabled={isViewMode || !formData.sellUnit}
                        />
                    </div>
                    <div className="col-span-6 flex items-end pb-1">
                        {formData.sellUnit && formData.sellConversionFactor && Number(formData.sellConversionFactor) > 0 && (
                            <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2">
                                1 <strong>{formData.sellUnit}</strong> = {formData.sellConversionFactor} <strong>{formData.unit}</strong>
                                {' '}· 10 {formData.sellUnit} = {10 * Number(formData.sellConversionFactor)} {formData.unit}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Pricing & Stock ───────────────────────────────────────── */}
            <div className="invoice-panel">
                <div className="invoice-panel-header">
                    <span className="invoice-panel-title">Pricing & Stock</span>
                </div>

                <div className="grid-12 form-grid-start">
                    <div className="col-span-3">
                        <Input label="Cost Price *" name="cost" type="number" value={formData.cost} onChange={handleChange} placeholder="0" error={errors.cost} disabled={isViewMode} />
                    </div>
                    <div className="col-span-3">
                        <Input label="Selling Price *" name="price" type="number" value={formData.price} onChange={handleChange} placeholder="0" error={errors.price} disabled={isViewMode} />
                    </div>

                    {/* Margin preview */}
                    <div className="col-span-2">
                        <div>
                            <label className="form-label">Gross Margin</label>
                            <div className={`inventory-margin-badge ${margin && margin.pct > 0 ? 'positive' : 'zero'}`}>
                                {margin ? `${margin.pct}%` : '—'}
                            </div>
                        </div>
                    </div>

                    <div className="col-span-2">
                        <Input label="Opening Stock" name="openingStock" type="number" value={formData.openingStock} onChange={handleChange} placeholder="0" error={errors.openingStock} disabled={isViewMode} />
                    </div>
                    <div className="col-span-2">
                        <Input label="Reorder Point" name="reorderPoint" type="number" value={formData.reorderPoint} onChange={handleChange} placeholder="5" error={errors.reorderPoint} disabled={isViewMode} />
                    </div>
                </div>
            </div>

            {/* ── Accounting ────────────────────────────────────────────── */}
            <div className="invoice-panel">
                <div className="invoice-panel-header">
                    <div>
                        <span className="invoice-panel-title">Accounting</span>
                        <span className="invoice-panel-subtitle"> — defaults are pre-filled from your Chart of Accounts</span>
                    </div>
                </div>

                <div className="grid-12 form-grid-start">
                    <div className="col-span-4">
                        <SelectField label="Inventory Account" name="inventoryAccountId" value={formData.inventoryAccountId} onChange={handleChange} error={errors.inventoryAccountId} disabled={isViewMode}>
                            <option value="">— Select Account —</option>
                            {inventoryAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-4">
                        <SelectField label="Revenue / Sales Account" name="revenueAccountId" value={formData.revenueAccountId} onChange={handleChange} error={errors.revenueAccountId} disabled={isViewMode}>
                            <option value="">— Select Account —</option>
                            {revenueAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-4">
                        <SelectField label="COGS Account" name="cogsAccountId" value={formData.cogsAccountId} onChange={handleChange} error={errors.cogsAccountId} disabled={isViewMode}>
                            <option value="">— Select Account —</option>
                            {cogsAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        </SelectField>
                    </div>
                </div>
            </div>

        </FormPage>
    );
};

export default InventoryForm;
