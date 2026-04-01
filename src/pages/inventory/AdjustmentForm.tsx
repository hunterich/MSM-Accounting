import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adjustmentSchema, zodToFormErrors } from '../../utils/formSchemas';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import FormPage from '../../components/Layout/FormPage';
import { useStockAdjustments, useItems, useCreateStockAdjustment, useUpdateStockAdjustment } from '../../hooks/useInventory';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import type { AdjStatus, AdjType } from '../../types';

interface AdjFormData {
    id: string;
    date: string;
    type: AdjType;
    reason: string;
    notes: string;
    status: AdjStatus;
}

interface AdjLine {
    id: string;
    itemId: string;
    accountId: string;
    oldQty: number;
    newQty: number;
    qtyDiff: number;
    unitCost: number;
}

const buildFormData = (adj: { id?: string; date?: string; type?: AdjType; reason?: string; notes?: string; status?: AdjStatus } | null): AdjFormData => {
    if (!adj) {
        return {
            id: '',
            date: new Date().toISOString().split('T')[0],
            type: 'Quantity',
            reason: '',
            notes: '',
            status: 'Draft'
        };
    }
    return {
        id: adj.id || '',
        date: adj.date || '',
        type: adj.type || 'Quantity',
        reason: adj.reason || '',
        notes: adj.notes || '',
        status: adj.status || 'Draft'
    };
};

const buildItems = (adj: { items?: Partial<AdjLine>[]; lines?: Partial<AdjLine>[] } | null, expenseAccounts: { id: string }[]): AdjLine[] => {
    const defaultAccountId = expenseAccounts[0]?.id || '';
    const sourceLines = adj?.items ?? adj?.lines ?? [];

    if (sourceLines.length > 0) {
        return sourceLines.map((line, index) => ({
            id: line.id || `line-${index}-${Date.now()}`,
            itemId: line.itemId || '',
            accountId: line.accountId || defaultAccountId,
            oldQty: Number(line.oldQty || 0),
            newQty: Number(line.newQty || 0),
            qtyDiff: Number(line.qtyDiff || 0),
            unitCost: Number(line.unitCost || 0)
        }));
    }

    return [{
        id: `line-0-${Date.now()}`,
        itemId: '',
        accountId: defaultAccountId,
        oldQty: 0,
        newQty: 0,
        qtyDiff: 0,
        unitCost: 0
    }];
};

const AdjustmentForm = () => {
    const navigate = useNavigate();
    const { canEdit } = useModulePermissions('inv_adj');
    const [searchParams] = useSearchParams();
    const adjId = searchParams.get('id') || '';
    const rawMode = searchParams.get('mode');
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'new';
    const isViewMode = mode === 'view';

    const createAdjustment = useCreateStockAdjustment();
    const updateAdjustmentMutation = useUpdateStockAdjustment();
    const { data: adjustmentsData, isLoading: adjustmentsLoading } = useStockAdjustments();
    const adjustments = adjustmentsData?.data ?? [];
    const { data: itemsData, isLoading: itemsLoading } = useItems();
    const products = itemsData?.data ?? [];
    const { data: allAccounts = [], isLoading: accountsLoading } = useChartOfAccounts();

    const isSaving = createAdjustment.isPending || updateAdjustmentMutation.isPending;
    const isPageLoading = adjustmentsLoading || itemsLoading || accountsLoading;

    const selectedAdj = useMemo(() => adjustments.find((a) => a.id === adjId) || null, [adjId, adjustments]);

    const expenseTargetAccounts = useMemo(() => {
        return allAccounts.filter(
            (account) =>
                account.isPostable &&
                account.isActive &&
                (account.type === 'Expense' || account.type === 'Cost of Goods Sold' || account.type === 'Asset' || account.type === 'Equity')
        );
    }, [allAccounts]);

    const [formData, setFormData] = useState<AdjFormData>(() => buildFormData(selectedAdj));
    const [items, setItems] = useState<AdjLine[]>(() => buildItems(selectedAdj, expenseTargetAccounts));
    const [errors, setErrors] = useState<Record<string, string | null | undefined>>({});

    useEffect(() => {
        setFormData(buildFormData(selectedAdj));
        setItems(buildItems(selectedAdj, expenseTargetAccounts));
        setErrors({});
    }, [selectedAdj, adjId, expenseTargetAccounts]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const handleItemSelect = (lineId: string, productId: string) => {
        const product = products.find(p => p.id === productId);
        if (product) {
            setItems((prev) => prev.map((line) => {
                if (line.id === lineId) {
                    return {
                        ...line,
                        itemId: productId,
                        oldQty: product.stock || 0,
                        newQty: product.stock || 0,
                        qtyDiff: 0,
                        unitCost: product.cost || 0
                    };
                }
                return line;
            }));
        } else {
            setItems((prev) => prev.map((line) => line.id === lineId ? { ...line, itemId: '', oldQty: 0, newQty: 0, qtyDiff: 0, unitCost: 0 } : line));
        }
    };

    const updateLine = (id: string, field: keyof AdjLine, value: string | number) => {
        setItems((prev) => prev.map((line) => {
            if (line.id === id) {
                const updatedLine = { ...line, [field]: value };
                if (field === 'newQty') {
                    updatedLine.qtyDiff = updatedLine.newQty - updatedLine.oldQty;
                } else if (field === 'qtyDiff') {
                    updatedLine.newQty = updatedLine.oldQty + updatedLine.qtyDiff;
                }
                return updatedLine;
            }
            return line;
        }));
    };

    const addLine = () => {
        setItems((prev) => [
            ...prev,
            {
                id: `line-${prev.length}-${Date.now()}`,
                itemId: '',
                accountId: expenseTargetAccounts[0]?.id || '',
                oldQty: 0,
                newQty: 0,
                qtyDiff: 0,
                unitCost: 0
            }
        ]);
    };

    const removeLine = (id: string) => {
        if (items.length > 1) {
            setItems((prev) => prev.filter((line) => line.id !== id));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isViewMode) {
            navigate('/inventory/adjustments');
            return;
        }

        const validItems = items.filter((line) => line.itemId && (line.qtyDiff !== 0 || line.unitCost > 0));
        const result = adjustmentSchema.safeParse({ ...formData, items: validItems });
        if (!result.success) { setErrors(zodToFormErrors(result.error)); return; }

        const payload = {
            number: formData.id || undefined,
            date:   formData.date,
            type:   formData.type as AdjType,
            reason: formData.reason,
            status: formData.status,
            notes:  formData.notes,
            lines:  validItems.map((line) => ({
                itemId:     line.itemId,
                accountId:  line.accountId,
                oldQty:     line.oldQty,
                newQty:     line.newQty,
                qtyDiff:    line.qtyDiff,
                unitCost:   line.unitCost,
                totalValue: line.qtyDiff * line.unitCost,
            })),
        };

        try {
            if (mode === 'edit' && selectedAdj) {
                await updateAdjustmentMutation.mutateAsync({ id: selectedAdj._id || selectedAdj.id, ...payload });
            } else {
                await createAdjustment.mutateAsync(payload);
            }
            navigate('/inventory/adjustments');
        } catch (err) {
            alert(`Failed to save adjustment: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    return (
        <FormPage
            title={mode === 'new' ? 'New Inventory Adjustment' : `Adjustment ${selectedAdj?.id || ''}`}
            backTo="/inventory/adjustments"
            isLoading={isPageLoading}
            actions={
                <div className="flex gap-2">
                    <Button text="Cancel" variant="secondary" onClick={() => navigate('/inventory/adjustments')} disabled={isSaving} />
                    {!isViewMode && <Button text={isSaving ? 'Saving...' : 'Save Adjustment'} variant="primary" onClick={handleSubmit} disabled={isSaving} />}
                    {isViewMode && <Button text="Edit Adjustment" variant="primary" disabled={!canEdit} onClick={() => navigate(`/inventory/adjustments/edit?id=${adjId}&mode=edit`)} />}
                </div>
            }
        >
            <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-5">
                <div className="col-span-12">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                        <div className="text-base font-semibold text-neutral-800 mb-4 pb-3 border-b border-neutral-100">Adjustment Details</div>
                        <div className="grid grid-cols-12 gap-x-5 gap-y-4">
                            <div className="col-span-6">
                                <Input
                                    label="Reference Number"
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
                                <label className="form-label block mb-1">Adjustment Type <span className="text-danger-500">*</span></label>
                                <select
                                    name="type"
                                    className="w-full h-10 px-3 rounded-md border text-sm border-neutral-300 bg-neutral-0 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-100"
                                    value={formData.type}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                >
                                    <option value="Quantity">Quantity Adjustment</option>
                                    <option value="Value">Value Adjustment</option>
                                </select>
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="Reason *"
                                    name="reason"
                                    placeholder="e.g. Damage, Shrinkage, Initial Stock"
                                    value={formData.reason}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                    error={errors.reason}
                                />
                            </div>
                            <div className="col-span-3">
                                <label className="form-label block mb-1">Status</label>
                                <select
                                    name="status"
                                    className="w-full h-10 px-3 rounded-md border text-sm border-neutral-300 bg-neutral-0 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-100"
                                    value={formData.status}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                >
                                    <option value="Draft">Draft</option>
                                    <option value="Approved">Approved</option>
                                </select>
                            </div>
                            <div className="col-span-12">
                                <Input
                                    label="Notes"
                                    name="notes"
                                    placeholder="Additional information"
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
                            <div className="text-base font-semibold text-neutral-800">Adjustment Items</div>
                            <Button text="Add Line" size="small" variant="secondary" onClick={addLine} disabled={isViewMode} />
                        </div>
                        {errors.items ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.items}</div> : null}
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm min-w-[800px]">
                                <thead>
                                    <tr>
                                        <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[25%]">Item</th>
                                        <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[20%]">Adjustment Account</th>
                                        <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[10%]">Current Qty</th>
                                        <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[10%]">New Qty</th>
                                        <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[10%]">Qty Diff</th>
                                        {formData.type === 'Value' && (
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[15%]">Unit Cost</th>
                                        )}
                                        <th className="p-2 border-b border-neutral-200 w-[5%]"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="text-center p-6 text-neutral-400">
                                                No items added
                                            </td>
                                        </tr>
                                    ) : items.map((line) => (
                                        <tr key={line.id} className="border-b border-neutral-100">
                                            <td className="p-2">
                                                <select
                                                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                                    value={line.itemId}
                                                    onChange={(e) => handleItemSelect(line.id, e.target.value)}
                                                    disabled={isViewMode}
                                                >
                                                    <option value="">Select Item...</option>
                                                    {products.map((p) => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="p-2">
                                                <select
                                                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
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
                                            <td className="p-2 text-center text-neutral-600 bg-neutral-50 rounded">
                                                {line.oldQty}
                                            </td>
                                            <td className="p-2">
                                                <Input
                                                    type="number"
                                                    value={line.newQty}
                                                    onChange={(e) => updateLine(line.id, 'newQty', Number(e.target.value))}
                                                    inputClassName="min-h-8 px-2 text-sm text-center"
                                                    disabled={isViewMode || formData.type === 'Value'}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <Input
                                                    type="number"
                                                    value={line.qtyDiff}
                                                    onChange={(e) => updateLine(line.id, 'qtyDiff', Number(e.target.value))}
                                                    inputClassName={`min-h-8 px-2 text-sm text-center ${line.qtyDiff < 0 ? 'text-danger-600' : line.qtyDiff > 0 ? 'text-success-600' : ''}`}
                                                    disabled={isViewMode || formData.type === 'Value'}
                                                />
                                            </td>
                                            {formData.type === 'Value' && (
                                                <td className="p-2">
                                                    <Input
                                                        type="number"
                                                        value={line.unitCost}
                                                        onChange={(e) => updateLine(line.id, 'unitCost', Number(e.target.value))}
                                                        inputClassName="min-h-8 px-2 text-sm text-right"
                                                        disabled={isViewMode}
                                                    />
                                                </td>
                                            )}
                                            <td className="p-2 text-center">
                                                <button
                                                    type="button"
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
                </div>
            </form>
        </FormPage>
    );
};

export default AdjustmentForm;
