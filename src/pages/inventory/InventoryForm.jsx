import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { useItems, useCreateItem, useUpdateItem } from '../../hooks/useInventory';
import { useChartOfAccounts } from '../../hooks/useGL';

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Item types available. The default type depends on the company's
 * business model — in a real app this would come from company settings.
 * "Product" is the right default for distribution/trading companies.
 * "Service" would be the default for service businesses.
 */
const ITEM_TYPES = ['Product', 'Service', 'Raw Material', 'Consumable', 'Fixed Asset'];

const UNITS = ['PCS', 'BOX', 'KG', 'GRAM', 'LITER', 'METER', 'HOUR', 'DAY', 'SET', 'UNIT', 'CARTON', 'DOZEN'];

/**
 * Pre-defined inventory categories.
 * Categories are used in inventory reports (Sales by Category, Stock by Category).
 * Users can pick from this list or add a new one inline.
 */
const DEFAULT_CATEGORIES = [
    'Hardware',
    'Accessories',
    'Electronics',
    'Peripherals',
    'Software',
    'Service',
    'Consumables',
    'Raw Material',
    'Finished Goods',
    'Semi-Finished',
    'Packaging',
    'Spare Parts',
    'Office Supplies',
];

// Default GL account IDs — from mockData chart of accounts.
// Users can override these per item.
const DEFAULT_INVENTORY_ACCOUNT = 'COA-1310'; // 131 — Persediaan Barang Dagang (Inventory Asset)
const DEFAULT_REVENUE_ACCOUNT   = 'COA-4100'; // 41  — Penjualan (Sales Revenue)
const DEFAULT_COGS_ACCOUNT      = 'COA-5100'; // 51  — Harga Pokok Penjualan (COGS)

const INVENTORY_ITEM_SEED = [
    { id: 'SKU-001', name: 'MacBook Pro 16"', category: 'Hardware', stock: 15, cost: 22000000, price: 25000000, status: 'In Stock' },
    { id: 'SKU-002', name: 'Dell XPS 13', category: 'Hardware', stock: 4, cost: 9000000, price: 12000000, status: 'Low Stock' },
    { id: 'SKU-003', name: 'USB-C Cable', category: 'Accessories', stock: 150, cost: 50000, price: 150000, status: 'In Stock' },
    { id: 'SKU-004', name: 'Monitor Stand', category: 'Accessories', stock: 0, cost: 250000, price: 450000, status: 'Out of Stock' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * SelectField — wraps label + select in form-group so it aligns perfectly
 * with the Input component inside the grid.
 */
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
            name:               '',
            category:           '',
            customCategory:     '',
            showCustomCategory: false,
            type:               'Product',          // Default for distribution/trading
            unit:               'PCS',
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
        sku:                item.id || '',
        name:               item.name || '',
        category:           item.category || '',
        customCategory:     '',
        showCustomCategory: false,
        type:               item.type || 'Product',
        unit:               item.unit || 'PCS',
        cost:               item.cost != null ? String(item.cost) : '',
        price:              item.price != null ? String(item.price) : '',
        openingStock:       item.stock != null ? String(item.stock) : '0',
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

    const createItem = useCreateItem();
    const updateItem = useUpdateItem();
    const { data: itemsData, isLoading: itemsLoading } = useItems();
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
        // Look up from API data first, fall back to seed
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

    // ── Filtered account lists ────────────────────────────────────────────
    const { data: allAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const inventoryAccounts = useMemo(
        () => allAccounts.filter((a) => a.isActive && a.isPostable && a.type === 'Asset'),
        [allAccounts]
    );
    const revenueAccounts = useMemo(
        () => allAccounts.filter((a) => a.isActive && a.isPostable && a.type === 'Revenue'),
        [allAccounts]
    );
    const cogsAccounts = useMemo(
        () => allAccounts.filter((a) => a.isActive && a.isPostable && a.type === 'Expense'),
        [allAccounts]
    );

    // Computed margin
    const margin = useMemo(() => {
        const cost  = Number(formData.cost)  || 0;
        const price = Number(formData.price) || 0;
        if (!price) return null;
        const pct = ((price - cost) / price) * 100;
        return { amount: price - cost, pct: pct.toFixed(1) };
    }, [formData.cost, formData.price]);

    // ── Handlers ─────────────────────────────────────────────────────────
    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev)    => ({ ...prev, [name]: null }));
    };

    const handleCategoryChange = (event) => {
        const { value } = event.target;
        if (value === '__new__') {
            setFormData((prev) => ({ ...prev, category: '', showCustomCategory: true }));
        } else {
            setFormData((prev) => ({ ...prev, category: value, showCustomCategory: false, customCategory: '' }));
            setErrors((prev)   => ({ ...prev, category: null }));
        }
    };

    const handleConfirmCustomCategory = () => {
        const trimmed = formData.customCategory.trim();
        if (!trimmed) {
            setErrors((prev) => ({ ...prev, category: 'Category is required.' }));
            return;
        }
        setFormData((prev) => ({ ...prev, category: trimmed, showCustomCategory: false, customCategory: '' }));
        setErrors((prev) => ({ ...prev, category: null }));
    };

    const validate = () => {
        const nextErrors = {};
        if (!formData.name.trim())     nextErrors.name     = 'Item name is required.';
        if (!formData.sku.trim())      nextErrors.sku      = 'SKU is required.';
        if (!formData.category.trim()) nextErrors.category = 'Category is required.';
        if (formData.price === '' || isNaN(Number(formData.price)) || Number(formData.price) < 0) {
            nextErrors.price = 'Selling price must be a valid non-negative number.';
        }
        if (formData.cost === '' || isNaN(Number(formData.cost)) || Number(formData.cost) < 0) {
            nextErrors.cost  = 'Cost price must be a valid non-negative number.';
        }
        if (formData.openingStock === '' || isNaN(Number(formData.openingStock)) || Number(formData.openingStock) < 0) {
            nextErrors.openingStock = 'Opening stock must be a valid non-negative number.';
        }
        if (formData.reorderPoint === '' || isNaN(Number(formData.reorderPoint)) || Number(formData.reorderPoint) < 0) {
            nextErrors.reorderPoint = 'Reorder point must be a valid non-negative number.';
        }
        if (!formData.inventoryAccountId) nextErrors.inventoryAccountId = 'Select an inventory account.';
        if (!formData.revenueAccountId) nextErrors.revenueAccountId = 'Select a revenue account.';
        if (!formData.cogsAccountId) nextErrors.cogsAccountId = 'Select a COGS account.';
        return nextErrors;
    };

    const handleSave = async () => {
        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return; }

        const category = formData.showCustomCategory
            ? formData.customCategory.trim()
            : formData.category;

        const payload = {
            sku:                formData.sku.trim(),
            name:               formData.name.trim(),
            category,
            type:               formData.type,
            unit:               formData.unit,
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

    // Build category select options — include existing item's category if not in default list
    const categoryOptions = useMemo(() => {
        const all = new Set([...DEFAULT_CATEGORIES]);
        if (formData.category && !all.has(formData.category)) all.add(formData.category);
        return Array.from(all).sort();
    }, [formData.category]);

    const isPageLoading = itemsLoading || chartOfAccountsLoading;

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
                    {/* Row 1: Name(5) SKU(3) Category(4) */}
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
                            onChange={handleChange}
                            placeholder="e.g. SKU-005"
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
                        {/* Category: dropdown + add new inline */}
                        {formData.showCustomCategory ? (
                            <div>
                                <label className="form-label">Category * <span className="text-muted" style={{ fontWeight: 400 }}>— New</span></label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <input
                                        className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                        name="customCategory"
                                        value={formData.customCategory}
                                        onChange={handleChange}
                                        placeholder="e.g. Networking"
                                        autoFocus
                                        onKeyDown={(e) => e.key === 'Enter' && handleConfirmCustomCategory()}
                                    />
                                    <button
                                        type="button"
                                        className="h-8 px-3 text-sm font-medium bg-primary-700 text-white rounded-md hover:bg-primary-800"
                                        onClick={handleConfirmCustomCategory}
                                        style={{ whiteSpace: 'nowrap', padding: '0 12px' }}
                                    >
                                        Add
                                    </button>
                                    <button
                                        type="button"
                                        className="h-8 px-3 text-sm font-medium bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-md hover:bg-neutral-200"
                                        onClick={() => setFormData((prev) => ({ ...prev, showCustomCategory: false, customCategory: '' }))}
                                        style={{ padding: '0 10px' }}
                                    >
                                        ✕
                                    </button>
                                </div>
                                {errors.category && <div className="form-feedback invalid-feedback">{errors.category}</div>}
                            </div>
                        ) : (
                            <div>
                                <label className="form-label">
                                    Category *
                                    {formData.category && (
                                        <span className="inventory-category-badge">{formData.category}</span>
                                    )}
                                </label>
                                <select
                                    className={`w-full h-10 px-3 rounded-md border bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 ${errors.category ? 'border-danger-500' : 'border-neutral-300'}`}
                                    name="category"
                                    value={formData.category}
                                    onChange={handleCategoryChange}
                                    disabled={isViewMode}
                                >
                                    <option value="">— Select Category —</option>
                                    {categoryOptions.map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                    {!isViewMode && <option value="__new__">+ Add new category…</option>}
                                </select>
                                {errors.category && <div className="form-feedback invalid-feedback">{errors.category}</div>}
                            </div>
                        )}
                    </div>

                    <div className="col-span-3">
                        <SelectField
                            label="Item Type"
                            name="type"
                            value={formData.type}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-2">
                        <SelectField
                            label="Unit"
                            name="unit"
                            value={formData.unit}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </SelectField>
                    </div>
                    <div className="col-span-3">
                        <SelectField
                            label="Status"
                            name="status"
                            value={formData.status}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive (Hidden from sales)</option>
                        </SelectField>
                    </div>

                    {/* Row 3: Description (full) */}
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

            {/* ── Pricing & Stock ───────────────────────────────────────── */}
            <div className="invoice-panel">
                <div className="invoice-panel-header">
                    <span className="invoice-panel-title">Pricing & Stock</span>
                </div>

                <div className="grid-12 form-grid-start">
                    {/* Row: Cost + Price + Margin display + Opening Stock + Reorder */}
                    <div className="col-span-3">
                        <Input
                            label="Cost Price *"
                            name="cost"
                            type="number"
                            value={formData.cost}
                            onChange={handleChange}
                            placeholder="0"
                            error={errors.cost}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="Selling Price *"
                            name="price"
                            type="number"
                            value={formData.price}
                            onChange={handleChange}
                            placeholder="0"
                            error={errors.price}
                            disabled={isViewMode}
                        />
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
                        <Input
                            label="Opening Stock"
                            name="openingStock"
                            type="number"
                            value={formData.openingStock}
                            onChange={handleChange}
                            placeholder="0"
                            error={errors.openingStock}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-2">
                        <Input
                            label="Reorder Point"
                            name="reorderPoint"
                            type="number"
                            value={formData.reorderPoint}
                            onChange={handleChange}
                            placeholder="5"
                            error={errors.reorderPoint}
                            disabled={isViewMode}
                        />
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
                    {/* Row: 3 account selects each col-span-4 = 12 */}
                    <div className="col-span-4">
                        <SelectField
                            label="Inventory Account"
                            name="inventoryAccountId"
                            value={formData.inventoryAccountId}
                            onChange={handleChange}
                            error={errors.inventoryAccountId}
                            disabled={isViewMode}
                        >
                            <option value="">— Select Account —</option>
                            {inventoryAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                            ))}
                        </SelectField>
                    </div>
                    <div className="col-span-4">
                        <SelectField
                            label="Revenue / Sales Account"
                            name="revenueAccountId"
                            value={formData.revenueAccountId}
                            onChange={handleChange}
                            error={errors.revenueAccountId}
                            disabled={isViewMode}
                        >
                            <option value="">— Select Account —</option>
                            {revenueAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                            ))}
                        </SelectField>
                    </div>
                    <div className="col-span-4">
                        <SelectField
                            label="COGS Account"
                            name="cogsAccountId"
                            value={formData.cogsAccountId}
                            onChange={handleChange}
                            error={errors.cogsAccountId}
                            disabled={isViewMode}
                        >
                            <option value="">— Select Account —</option>
                            {cogsAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                            ))}
                        </SelectField>
                    </div>
                </div>
            </div>

        </FormPage>
    );
};

export default InventoryForm;
