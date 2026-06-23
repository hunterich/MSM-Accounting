import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import StatusTag from '../../components/UI/StatusTag';
import FormPage from '../../components/Layout/FormPage';
import {
    useStockCount,
    useCreateStockCount,
    useUpdateStockCount,
    useSubmitStockCount,
    useReopenStockCount,
    usePostStockCount,
    useCancelStockCount,
    useItems,
    useItemCategories,
    useWarehouses,
    type StockCountLineRow,
} from '../../hooks/useInventory';
import { useModulePermissions } from '../../hooks/useModulePermissions';

// ── StatusTag helper ───────────────────────────────────────────────────────────

function countStatusTag(status: string): { status: string; label: string } {
    switch (status) {
        case 'POSTED':    return { status: 'Success', label: 'Posted' };
        case 'SUBMITTED': return { status: 'Warning', label: 'Submitted' };
        case 'CANCELLED': return { status: 'Error',   label: 'Cancelled' };
        default:          return { status: 'draft',   label: 'Draft' };
    }
}

// ── Local row shape (edit state) ───────────────────────────────────────────────

interface CountRow {
    itemId: string;
    name: string;
    sku: string;
    systemQty: number;
    countedQty: number | null;
    note: string;
    changedSinceCount?: boolean;
}

function lineToRow(line: StockCountLineRow): CountRow {
    return {
        itemId:           line.itemId,
        name:             line.item?.name ?? '',
        sku:              line.item?.sku  ?? '',
        systemQty:        Number(line.systemQty ?? 0),
        countedQty:       line.countedQty != null ? Number(line.countedQty) : null,
        note:             line.note ?? '',
        changedSinceCount: line.changedSinceCount,
    };
}

// ── Variance display ───────────────────────────────────────────────────────────

function VarianceCell({ systemQty, countedQty }: { systemQty: number; countedQty: number | null }) {
    if (countedQty == null) return <span className="text-neutral-400">—</span>;
    const cleanDiff = Number((countedQty - systemQty).toFixed(4));
    if (cleanDiff > 0) return <span style={{ color: '#2b8a3e' }} className="font-medium">+{cleanDiff}</span>;
    if (cleanDiff < 0) return <span style={{ color: '#c92a2a' }} className="font-medium">{cleanDiff}</span>;
    return <span className="text-neutral-600">0</span>;
}

// ── Today's date helper ────────────────────────────────────────────────────────

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

// ── New mode panel ─────────────────────────────────────────────────────────────

interface NewCountPanelProps {
    onCreated: (id: string) => void;
}

function NewCountPanel({ onCreated }: NewCountPanelProps) {
    const [date, setDate]           = useState(todayIso);
    const [categoryId, setCategoryId] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [countedBy, setCountedBy] = useState('');
    const [notes, setNotes]         = useState('');
    const [apiError, setApiError]   = useState<string | null>(null);

    const createMutation = useCreateStockCount();
    const { data: categories = [] } = useItemCategories();
    const { data: warehouses = [] }  = useWarehouses();

    const categoryOptions = useMemo(
        () => categories.map((c) => ({ value: c.id, label: c.name })),
        [categories]
    );
    const warehouseOptions = useMemo(
        () => warehouses.map((w) => ({ value: w.id, label: w.name })),
        [warehouses]
    );

    const handleCreate = async () => {
        setApiError(null);
        try {
            const created = await createMutation.mutateAsync({
                date,
                categoryId:  categoryId  || undefined,
                warehouseId: warehouseId || undefined,
                countedBy:   countedBy   || undefined,
                notes:       notes       || undefined,
            });
            onCreated(created.id);
        } catch (err) {
            setApiError(err instanceof Error ? err.message : 'Failed to create stock count');
        }
    };

    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-6 max-w-2xl">
            <div className="text-base font-semibold text-neutral-800 mb-4 pb-3 border-b border-neutral-100">
                New Stock Count
            </div>
            {apiError && (
                <div className="mb-4 p-3 rounded-md bg-danger-50 border border-danger-200 text-danger-700 text-sm">
                    {apiError}
                </div>
            )}
            <div className="grid grid-cols-12 gap-x-5 gap-y-1">
                <div className="col-span-6">
                    <Input
                        label="Date *"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>
                <div className="col-span-6">
                    <label className="block mb-2 text-sm font-medium text-neutral-700">Counted By</label>
                    <Input
                        placeholder="Name of counter"
                        value={countedBy}
                        onChange={(e) => setCountedBy(e.target.value)}
                        wrapperClassName=""
                    />
                </div>
                <div className="col-span-6">
                    <SearchableSelect
                        label="Category (optional)"
                        options={categoryOptions}
                        value={categoryId}
                        onChange={setCategoryId}
                        placeholder="All categories"
                        className="mb-0"
                    />
                </div>
                <div className="col-span-6">
                    <SearchableSelect
                        label="Warehouse (optional)"
                        options={warehouseOptions}
                        value={warehouseId}
                        onChange={setWarehouseId}
                        placeholder="All warehouses"
                        className="mb-0"
                    />
                </div>
                <div className="col-span-12 mt-1">
                    <label className="block mb-2 text-sm font-medium text-neutral-700">Notes</label>
                    <textarea
                        className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:outline-none focus:border-primary-500 focus:shadow-[0_0_0_3px_var(--color-primary-100)] min-h-[72px] resize-y"
                        placeholder="Optional notes about this count"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>
            </div>
            <div className="mt-5 flex justify-end">
                <Button
                    text={createMutation.isPending ? 'Creating…' : 'Create count'}
                    variant="primary"
                    onClick={handleCreate}
                    disabled={createMutation.isPending || !date}
                />
            </div>
        </div>
    );
}

// ── Edit mode worksheet ────────────────────────────────────────────────────────

interface WorksheetProps {
    id: string;
    viewMode: boolean;
}

function CountWorksheet({ id, viewMode }: WorksheetProps) {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('inv_adj');

    const { data: count, isLoading } = useStockCount(id);
    const { data: itemsData }        = useItems();
    const { data: categories = [] }  = useItemCategories();
    const { data: warehouses = [] }  = useWarehouses();

    const allItems = itemsData?.data ?? [];

    const updateMutation   = useUpdateStockCount();
    const submitMutation   = useSubmitStockCount();
    const reopenMutation   = useReopenStockCount();
    const postMutation     = usePostStockCount();
    const cancelMutation   = useCancelStockCount();

    const [rows, setRows]           = useState<CountRow[]>([]);
    const [countedBy, setCountedBy] = useState('');
    const [notes, setNotes]         = useState('');
    const [apiError, setApiError]   = useState<string | null>(null);

    // Seed rows from loaded count
    useEffect(() => {
        if (!count) return;
        setRows((count.lines ?? []).map(lineToRow));
        setCountedBy(count.countedBy ?? '');
        setNotes(count.notes ?? '');
        setApiError(null);
    }, [count?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const status = count?.status ?? 'DRAFT';
    const isDraft     = status === 'DRAFT';
    const isSubmitted = status === 'SUBMITTED';
    const isPosted    = status === 'POSTED';
    const isCancelled = status === 'CANCELLED';

    const inputsDisabled = viewMode || !isDraft;

    // Progress counter
    const countedCount = rows.filter((r) => r.countedQty != null).length;

    // Add-item select — exclude already-in rows
    const rowItemIds = useMemo(() => new Set(rows.map((r) => r.itemId)), [rows]);
    const addItemOptions = useMemo(
        () =>
            allItems
                .filter((i) => !rowItemIds.has(i.id))
                .map((i) => ({ value: i.id, label: i.name, subLabel: i.sku })),
        [allItems, rowItemIds]
    );

    // Category/warehouse label lookup
    const categoryName = useMemo(
        () => categories.find((c) => c.id === count?.categoryId)?.name,
        [categories, count?.categoryId]
    );
    const warehouseName = useMemo(
        () => warehouses.find((w) => w.id === count?.warehouseId)?.name,
        [warehouses, count?.warehouseId]
    );

    // ── Helpers ────────────────────────────────────────────────────────────────

    const buildLines = () =>
        rows.map((r) => ({
            itemId:     r.itemId,
            countedQty: r.countedQty,
            note:       r.note,
        }));

    const handleSave = async () => {
        setApiError(null);
        try {
            await updateMutation.mutateAsync({
                id,
                countedBy: countedBy || undefined,
                notes:     notes     || undefined,
                lines:     buildLines(),
            });
        } catch (err) {
            setApiError(err instanceof Error ? err.message : 'Save failed');
        }
    };

    const handleSubmit = async () => {
        setApiError(null);
        try {
            await updateMutation.mutateAsync({
                id,
                countedBy: countedBy || undefined,
                notes:     notes     || undefined,
                lines:     buildLines(),
            });
            await submitMutation.mutateAsync(id);
        } catch (err) {
            setApiError(err instanceof Error ? err.message : 'Submit failed');
        }
    };

    const handleReopen = async () => {
        setApiError(null);
        try { await reopenMutation.mutateAsync(id); }
        catch (err) { setApiError(err instanceof Error ? err.message : 'Reopen failed'); }
    };

    const handlePost = async () => {
        setApiError(null);
        try {
            await postMutation.mutateAsync(id);
            navigate(`/inventory/counts?countId=${id}`);
        } catch (err) {
            setApiError(err instanceof Error ? err.message : 'Post failed');
        }
    };

    const handleCancel = async () => {
        setApiError(null);
        try { await cancelMutation.mutateAsync(id); }
        catch (err) { setApiError(err instanceof Error ? err.message : 'Cancel failed'); }
    };

    const handleAddItem = (itemId: string) => {
        const item = allItems.find((i) => i.id === itemId);
        if (!item) return;
        setRows((prev) => [
            ...prev,
            {
                itemId,
                name:       item.name,
                sku:        item.sku,
                systemQty:  item.currentStock,
                countedQty: null,
                note:       '',
            },
        ]);
    };

    const updateRow = (idx: number, field: 'countedQty' | 'note', value: string) => {
        setRows((prev) =>
            prev.map((r, i) => {
                if (i !== idx) return r;
                if (field === 'countedQty') {
                    const parsed = value === '' ? null : Number(value);
                    return { ...r, countedQty: parsed !== null && Number.isNaN(parsed) ? null : parsed };
                }
                return { ...r, note: value };
            })
        );
    };

    const isBusy =
        updateMutation.isPending ||
        submitMutation.isPending ||
        reopenMutation.isPending ||
        postMutation.isPending   ||
        cancelMutation.isPending;

    // ── Actions bar content ────────────────────────────────────────────────────

    const actions = (
        <div className="flex gap-2 flex-wrap">
            {isDraft && (
                <>
                    <Button
                        text={updateMutation.isPending ? 'Saving…' : 'Save draft'}
                        variant="secondary"
                        onClick={handleSave}
                        disabled={isBusy || !canEdit}
                    />
                    <Button
                        text={submitMutation.isPending ? 'Submitting…' : 'Submit for review'}
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={isBusy || !canCreate}
                    />
                    <Button
                        text="Cancel count"
                        variant="danger"
                        onClick={handleCancel}
                        disabled={isBusy || !canEdit}
                    />
                </>
            )}
            {isSubmitted && (
                <>
                    <Button
                        text={reopenMutation.isPending ? 'Reopening…' : 'Reopen'}
                        variant="secondary"
                        onClick={handleReopen}
                        disabled={isBusy || !canEdit}
                    />
                    <Button
                        text="Cancel count"
                        variant="danger"
                        onClick={handleCancel}
                        disabled={isBusy || !canEdit}
                    />
                    <Button
                        text={postMutation.isPending ? 'Posting…' : 'Post'}
                        variant="primary"
                        onClick={handlePost}
                        disabled={isBusy || !canCreate}
                    />
                </>
            )}
            {(isPosted || isCancelled) && (
                <Button
                    text="View in workbench"
                    variant="secondary"
                    onClick={() => navigate(`/inventory/counts?countId=${id}`)}
                />
            )}
        </div>
    );

    return (
        <FormPage
            title={count ? `Stock Count ${count.number}` : 'Stock Count'}
            backTo="/inventory/counts"
            backLabel="Back to Stock Counts"
            isLoading={isLoading}
            actions={actions}
        >
            {/* API error banner */}
            {apiError && (
                <div className="mb-4 p-3 rounded-md bg-danger-50 border border-danger-200 text-danger-700 text-sm">
                    {apiError}
                </div>
            )}

            {count && (
                <div className="grid grid-cols-12 gap-5">
                    {/* Header card */}
                    <div className="col-span-12">
                        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                            <div className="flex flex-wrap items-center gap-3 mb-3">
                                <span className="text-base font-semibold text-neutral-800">{count.number}</span>
                                <span className="text-neutral-400 text-sm">{count.date ? count.date.slice(0, 10) : ''}</span>
                                <StatusTag {...countStatusTag(count.status)} />
                            </div>
                            {/* Scope chips */}
                            <div className="flex flex-wrap gap-2 mb-3">
                                {categoryName && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-100">
                                        Category: {categoryName}
                                    </span>
                                )}
                                {warehouseName && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-100">
                                        Warehouse: {warehouseName}
                                    </span>
                                )}
                                {count.countedBy && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
                                        Counted by: {count.countedBy}
                                    </span>
                                )}
                                {!categoryName && !warehouseName && (
                                    <span className="text-sm text-neutral-500">All items</span>
                                )}
                            </div>
                            {/* Progress */}
                            <div className="text-sm text-neutral-600">
                                {countedCount} of {rows.length} items counted
                            </div>
                        </div>
                    </div>

                    {/* Header meta editable fields (only for DRAFT) */}
                    {isDraft && (
                        <div className="col-span-12">
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                                <div className="text-base font-semibold text-neutral-800 mb-4 pb-3 border-b border-neutral-100">
                                    Count Details
                                </div>
                                <div className="grid grid-cols-12 gap-x-5 gap-y-1">
                                    <div className="col-span-6">
                                        <Input
                                            label="Counted By"
                                            placeholder="Name of counter"
                                            value={countedBy}
                                            onChange={(e) => setCountedBy(e.target.value)}
                                            disabled={inputsDisabled}
                                        />
                                    </div>
                                    <div className="col-span-12">
                                        <label className="block mb-2 text-sm font-medium text-neutral-700">Notes</label>
                                        <textarea
                                            className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:outline-none focus:border-primary-500 focus:shadow-[0_0_0_3px_var(--color-primary-100)] min-h-[60px] resize-y disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                            placeholder="Additional notes"
                                            value={notes}
                                            disabled={inputsDisabled}
                                            onChange={(e) => setNotes(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Read-only notes for non-DRAFT states */}
                    {!isDraft && count.notes && (
                        <div className="col-span-12">
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                                <div className="text-base font-semibold text-neutral-800 mb-4 pb-3 border-b border-neutral-100">
                                    Count Details
                                </div>
                                <div>
                                    <label className="block mb-1 text-sm font-medium text-neutral-700">Notes</label>
                                    <div className="text-sm text-neutral-800 whitespace-pre-wrap">{count.notes}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Worksheet table */}
                    <div className="col-span-12">
                        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                            <div className="flex justify-between items-center mb-4 pb-3 border-b border-neutral-100">
                                <div className="text-base font-semibold text-neutral-800">Count Lines</div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-sm min-w-[640px]">
                                    <thead>
                                        <tr>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[35%]">Item</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[12%]">System Qty</th>
                                            <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[14%]">Counted</th>
                                            <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[10%]">Variance</th>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600">Note</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="text-center p-8 text-neutral-400">
                                                    No items in this count yet. Use the selector below to add items.
                                                </td>
                                            </tr>
                                        ) : (
                                            rows.map((row, idx) => (
                                                <tr key={row.itemId} className="border-b border-neutral-100 hover:bg-neutral-50">
                                                    <td className="p-2">
                                                        <div className="font-medium text-neutral-800">{row.name}</div>
                                                        {row.sku && (
                                                            <div className="text-xs text-neutral-500">{row.sku}</div>
                                                        )}
                                                        {isSubmitted && row.changedSinceCount && (
                                                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-50 text-warning-800 border border-warning-200">
                                                                ⚠ system changed since count
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-2 text-right text-neutral-600">
                                                        {row.systemQty}
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="number"
                                                            className="block w-full px-2 py-1 text-sm text-center text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:outline-none focus:border-primary-500 focus:shadow-[0_0_0_2px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                                            value={row.countedQty ?? ''}
                                                            placeholder="—"
                                                            disabled={inputsDisabled}
                                                            onChange={(e) => updateRow(idx, 'countedQty', e.target.value)}
                                                        />
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        <VarianceCell
                                                            systemQty={row.systemQty}
                                                            countedQty={row.countedQty}
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            className="block w-full px-2 py-1 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:outline-none focus:border-primary-500 focus:shadow-[0_0_0_2px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                                            value={row.note}
                                                            placeholder="Optional note"
                                                            disabled={inputsDisabled}
                                                            onChange={(e) => updateRow(idx, 'note', e.target.value)}
                                                        />
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Add item — only for DRAFT */}
                            {isDraft && !viewMode && (
                                <div className="mt-4 pt-4 border-t border-neutral-100">
                                    <div className="text-sm font-medium text-neutral-700 mb-2">＋ Add item</div>
                                    <div className="max-w-sm">
                                        <SearchableSelect
                                            options={addItemOptions}
                                            value=""
                                            onChange={handleAddItem}
                                            placeholder="Search and select item…"
                                            className="mb-0"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Workbench link for posted/cancelled */}
                    {(isPosted || isCancelled) && (
                        <div className="col-span-12">
                            <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-sm text-neutral-600">
                                This count is {isPosted ? 'posted' : 'cancelled'} and is read-only.{' '}
                                <button
                                    type="button"
                                    className="text-primary-700 underline hover:text-primary-800"
                                    onClick={() => navigate(`/inventory/counts?countId=${id}`)}
                                >
                                    View in workbench
                                </button>
                                {isPosted && count.generatedAdjustmentId && (
                                    <>
                                        {' '}or{' '}
                                        <button
                                            type="button"
                                            className="text-primary-700 underline hover:text-primary-800"
                                            onClick={() => navigate(`/inventory/adjustments/edit?id=${count.generatedAdjustmentId}&mode=view`)}
                                        >
                                            view generated adjustment
                                        </button>
                                        .
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </FormPage>
    );
}

// ── Root export ────────────────────────────────────────────────────────────────

const StockCountForm: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const id   = searchParams.get('id') ?? '';
    const mode = searchParams.get('mode') === 'view' ? 'view' : id ? 'edit' : 'new';

    if (mode === 'new') {
        return (
            <FormPage
                title="New Stock Count"
                backTo="/inventory/counts"
                backLabel="Back to Stock Counts"
            >
                <NewCountPanel
                    onCreated={(createdId) => navigate(`/inventory/counts/edit?id=${createdId}`)}
                />
            </FormPage>
        );
    }

    return <CountWorksheet id={id} viewMode={mode === 'view'} />;
};

export default StockCountForm;
