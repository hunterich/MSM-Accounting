import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { usePurchaseOrderStore } from '../../stores/usePurchaseOrderStore';
import { useGLStore } from '../../stores/useGLStore';
import { useVendorStore } from '../../stores/useVendorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

const buildFormData = (po) => {
    if (!po) {
        return {
            id: '',
            vendorId: '',
            date: new Date().toISOString().split('T')[0],
            expectedDate: '',
            notes: ''
        };
    }
    return {
        id: po.id || '',
        vendorId: po.vendorId || '',
        date: po.date || '',
        expectedDate: po.expectedDate || '',
        notes: po.notes || ''
    };
};

const buildItems = (poId, expenseAccounts, templates) => {
    const defaultAccountId = expenseAccounts[0]?.id || '';
    const source = templates[poId] || [];

    if (source.length > 0) {
        return source.map((line, index) => ({
            id: line.id || `line-${index}-${Date.now()}`,
            accountId: line.accountId || defaultAccountId,
            description: line.description || '',
            qty: line.qty || 1,
            unit: line.unit || 'pcs',
            price: line.price || 0
        }));
    }

    return [{
        id: `line-0-${Date.now()}`,
        accountId: defaultAccountId,
        description: '',
        qty: 1,
        unit: 'pcs',
        price: 0
    }];
};

const POForm = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const poId = searchParams.get('poId') || '';
    const rawMode = searchParams.get('mode');
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'new';
    const isViewMode = mode === 'view';

    const purchaseOrders = usePurchaseOrderStore(s => s.purchaseOrders);
    const poItemTemplates = usePurchaseOrderStore(s => s.poItemTemplates);
    const addPurchaseOrder = usePurchaseOrderStore(s => s.addPurchaseOrder);
    const updatePurchaseOrder = usePurchaseOrderStore(s => s.updatePurchaseOrder);
    const setPoItemTemplates = usePurchaseOrderStore(s => s.setPoItemTemplates);

    const chartOfAccounts = useGLStore(s => s.chartOfAccounts);
    const vendors = useVendorStore(s => s.vendors);

    const selectedPO = useMemo(() => purchaseOrders.find((po) => po.id === poId) || null, [poId, purchaseOrders]);

    const accountMap = useMemo(() => {
        return chartOfAccounts.reduce((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const expenseTargetAccounts = useMemo(() => {
        return chartOfAccounts.filter(
            (account) =>
                account.isPostable &&
                account.isActive &&
                (account.type === 'Expense' || account.type === 'Asset')
        );
    }, [chartOfAccounts]);

    const [formData, setFormData] = useState(() => buildFormData(selectedPO));
    const [items, setItems] = useState(() => buildItems(poId, expenseTargetAccounts, poItemTemplates));
    const [errors, setErrors] = useState({});

    const globalTaxSettings = useSettingsStore(s => s.taxSettings);
    const [taxSettings, setTaxSettings] = useState({
        enabled: globalTaxSettings.enabled,
        inclusive: globalTaxSettings.inclusiveByDefault,
        rate: globalTaxSettings.defaultRate
    });

    useEffect(() => {
        setFormData(buildFormData(selectedPO));
        setItems(buildItems(poId, expenseTargetAccounts, poItemTemplates));
        setErrors({});
    }, [selectedPO, poId, expenseTargetAccounts, poItemTemplates]);

    const formatAccountOption = (accountId) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown Account';
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const updateLine = (id, field, value) => {
        setItems((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
    };

    const addLine = () => {
        setItems((prev) => [
            ...prev,
            {
                id: `line-${prev.length}-${Date.now()}`,
                accountId: expenseTargetAccounts[0]?.id || '',
                description: '',
                qty: 1,
                unit: 'pcs',
                price: 0
            }
        ]);
    };

    const removeLine = (id) => {
        if (items.length > 1) {
            setItems((prev) => prev.filter((line) => line.id !== id));
        }
    };

    const lineTotal = (line) => line.qty * line.price;
    const subtotal = items.reduce((sum, line) => sum + lineTotal(line), 0);

    const taxAmount = (() => {
        if (!taxSettings.enabled) return 0;
        const rate = taxSettings.rate / 100;
        if (taxSettings.inclusive) {
            return subtotal - (subtotal / (1 + rate));
        }
        return subtotal * rate;
    })();

    const totalAmount = taxSettings.enabled && !taxSettings.inclusive ? subtotal + taxAmount : subtotal;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isViewMode) {
            navigate('/ap/pos');
            return;
        }

        const nextErrors = {};
        if (!formData.vendorId) nextErrors.vendorId = 'Vendor is required';
        if (!formData.date) nextErrors.date = 'Date is required';

        const validItems = items.filter((line) => line.description.trim() || line.price > 0 || line.qty > 1);
        if (validItems.length === 0) {
            nextErrors.items = 'At least one item is required';
        }

        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        const newId = formData.id || `PO-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
        const finalId = isViewMode ? poId : newId;

        const finalPO = {
            id: finalId,
            vendorId: formData.vendorId,
            date: formData.date,
            expectedDate: formData.expectedDate,
            amount: totalAmount,
            status: mode === 'edit' ? selectedPO?.status : 'Approved',
            taxRate: taxSettings.enabled ? taxSettings.rate : 0,
            notes: formData.notes
        };

        if (mode === 'edit' && selectedPO) {
            updatePurchaseOrder(selectedPO.id, finalPO);
        } else {
            addPurchaseOrder(finalPO);
        }

        setPoItemTemplates(finalId, validItems);

        navigate('/ap/pos');
    };

    return (
        <FormPage
            title={mode === 'new' ? 'New Purchase Order' : `Purchase Order ${selectedPO?.id || ''}`}
            backLink="/ap/pos"
            actions={
                <div className="flex gap-2">
                    <Button text="Cancel" variant="secondary" onClick={() => navigate('/ap/pos')} />
                    {!isViewMode && <Button text="Save Purchase Order" variant="primary" onClick={handleSubmit} />}
                    {isViewMode && <Button text="Edit Purchase Order" variant="primary" onClick={() => navigate(`/ap/pos/edit?poId=${poId}&mode=edit`)} />}
                </div>
            }
        >
            <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-5">
                <div className="col-span-12">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                        <div className="text-base font-semibold text-neutral-800 mb-4 pb-3 border-b border-neutral-100">PO Details</div>
                        <div className="grid grid-cols-12 gap-x-5 gap-y-4">
                            <div className="col-span-6">
                                <label className="form-label block mb-1">Vendor <span className="text-danger-500">*</span></label>
                                <select
                                    name="vendorId"
                                    className={`w-full h-10 px-3 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-100 ${errors.vendorId ? 'border-danger-500' : 'border-neutral-300 bg-neutral-0'} disabled:bg-neutral-100`}
                                    value={formData.vendorId}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                >
                                    <option value="">Select Vendor...</option>
                                    {vendors.map((vendor) => (
                                        <option key={vendor.id} value={vendor.id}>{vendor.id} - {vendor.name}</option>
                                    ))}
                                </select>
                                {errors.vendorId && <span className="text-danger-500 text-xs mt-1 block">{errors.vendorId}</span>}
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="PO Number (Auto-assigned if empty)"
                                    name="id"
                                    placeholder="Leave blank to auto-generate"
                                    value={formData.id}
                                    onChange={handleChange}
                                    disabled={isViewMode || mode === 'edit'}
                                />
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Date *"
                                    name="date"
                                    type="date"
                                    value={formData.date}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                    error={errors.date}
                                />
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Expected Date"
                                    name="expectedDate"
                                    type="date"
                                    value={formData.expectedDate}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                />
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="Internal Notes"
                                    name="notes"
                                    placeholder="Notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-span-12">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4">
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-neutral-100">
                            <div className="text-base font-semibold text-neutral-800">Order Items</div>
                            <Button text="Add Line" size="small" variant="secondary" onClick={addLine} disabled={isViewMode} />
                        </div>
                        {errors.items ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.items}</div> : null}
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr>
                                    <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[25%]">Description</th>
                                    <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[25%]">Target Account</th>
                                    <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Qty</th>
                                    <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Unit</th>
                                    <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[14%]">Price</th>
                                    <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[14%]">Line Total</th>
                                    <th className="p-2 border-b border-neutral-200 w-[6%]"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center p-6 text-neutral-400">
                                            No items added
                                        </td>
                                    </tr>
                                ) : items.map((line) => (
                                    <tr key={line.id} className="border-b border-neutral-100">
                                        <td className="p-2">
                                            <Input
                                                value={line.description}
                                                onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                                                placeholder="Description"
                                                disabled={isViewMode}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <select
                                                className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                                value={line.accountId}
                                                onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                                                disabled={isViewMode}
                                            >
                                                {expenseTargetAccounts.map((account) => (
                                                    <option key={account.id} value={account.id}>
                                                        {account.code} - {account.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="p-2">
                                            <Input
                                                type="number"
                                                value={line.qty}
                                                onChange={(e) => updateLine(line.id, 'qty', Number(e.target.value))}
                                                inputClassName="min-h-8 px-2 text-sm text-center"
                                                disabled={isViewMode}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <Input
                                                value={line.unit}
                                                onChange={(e) => updateLine(line.id, 'unit', e.target.value)}
                                                inputClassName="min-h-8 px-2 text-sm text-center"
                                                disabled={isViewMode}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <Input
                                                type="number"
                                                value={line.price}
                                                onChange={(e) => updateLine(line.id, 'price', Number(e.target.value))}
                                                inputClassName="min-h-8 px-2 text-sm text-right"
                                                disabled={isViewMode}
                                            />
                                        </td>
                                        <td className="p-2 text-right font-semibold text-neutral-800">
                                            {formatIDR(lineTotal(line))}
                                        </td>
                                        <td className="p-2 text-center">
                                            <button
                                                onClick={() => removeLine(line.id)}
                                                className="text-danger-500 hover:text-danger-700 text-lg font-bold bg-transparent border-0 cursor-pointer"
                                                title="Remove"
                                                disabled={isViewMode}
                                            >
                                                ×
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Totals Section */}
                <div className="col-span-12 flex justify-end mt-2">
                    <div className="w-[350px]">
                        <div className="p-5 bg-neutral-50 border border-neutral-200 rounded-lg">
                            <div className="mb-4 flex flex-col gap-2 border-b border-neutral-200 pb-4">
                                <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={taxSettings.enabled}
                                        onChange={(e) => setTaxSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                                        disabled={isViewMode}
                                        className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    Include default global Tax ({taxSettings.rate}%)
                                </label>
                            </div>
                            <div className="flex justify-between items-center mb-2.5">
                                <span className="text-neutral-600">Subtotal</span>
                                <span className="font-semibold">{formatIDR(subtotal)}</span>
                            </div>
                            {taxSettings.enabled && (
                                <div className="flex justify-between items-center mb-2.5">
                                    <span className="text-neutral-600">Tax ({taxSettings.rate}%) {taxSettings.inclusive ? '(Inc)' : ''}</span>
                                    <span className="font-semibold text-neutral-600">{formatIDR(taxAmount)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-baseline mt-2 pt-3 border-t border-neutral-200">
                                <span className="text-[1.1rem] font-bold text-neutral-800">Total</span>
                                <span className="text-[1.4rem] font-extrabold text-primary-700">{formatIDR(totalAmount)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </FormPage>
    );
};

export default POForm;
