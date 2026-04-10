import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import FormPage from '../../components/Layout/FormPage';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import {
    useCreateBillImport,
    useFinalizeBillImport,
    useBillImportSession,
    useUpdateBillImportSession,
} from '../../hooks/useBillImports';
import { useVendors } from '../../hooks/useAP';
import { useItems } from '../../hooks/useInventory';
import { useChartOfAccounts } from '../../hooks/useGL';
import { formatIDR } from '../../utils/formatters';
import type { BillImportLine, BillImportReviewData } from '../../types';

// ── Types ──────────────────────────────────────────────────────────────────────

/** State of the multi-step wizard expressed as the current review payload. */
type ReviewState = BillImportReviewData;

// ── Constants ──────────────────────────────────────────────────────────────────

const EMPTY_REVIEW: ReviewState = {
    vendorId: '',
    vendorSuggestion: null,
    issueDate: '',
    dueDate: '',
    taxRate: 0,
    taxAmount: 0,
    subtotal: 0,
    totalAmount: 0,
    notes: '',
    lines: [],
    needsReviewCount: 0,
    readyToImport: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const toNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

// ── Component ──────────────────────────────────────────────────────────────────

const BillImport: React.FC = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [sessionId, setSessionId] = useState<string>('');
    const [reviewData, setReviewData] = useState<ReviewState>(EMPTY_REVIEW);
    const [error, setError] = useState<string>('');
    const [successMessage, setSuccessMessage] = useState<string>('');

    const { data: session, isLoading: sessionLoading } = useBillImportSession(sessionId || undefined);
    const createImport = useCreateBillImport();
    const updateImport = useUpdateBillImportSession();
    const finalizeImport = useFinalizeBillImport();

    const { data: vendorsResult } = useVendors({ limit: 200 });
    const vendors = vendorsResult?.data ?? [];
    const { data: itemsResult } = useItems({ limit: 500, isActive: true });
    const items = itemsResult?.data ?? [];
    const { data: accounts = [] } = useChartOfAccounts();

    useEffect(() => {
        if (session?.normalizedData) {
            setReviewData(session.normalizedData);
            setSuccessMessage(session.createdBill ? `Draft bill ${session.createdBill.number} created successfully.` : '');
        }
    }, [session]);

    const expenseAccounts = useMemo(() => (
        accounts.filter((account) => account.isActive && account.isPostable && (account.type === 'Expense' || account.type === 'Asset'))
    ), [accounts]);

    const vendorOptions = useMemo(() => (
        vendors.map((vendor) => ({ value: vendor.id, label: vendor.name ?? '', subLabel: vendor.code ?? undefined }))
    ), [vendors]);

    const itemOptions = useMemo(() => (
        items.map((item) => ({ value: item.id, label: item.name ?? '', subLabel: item.sku ?? undefined }))
    ), [items]);

    const accountOptions = useMemo(() => (
        expenseAccounts.map((account) => ({ value: account.id, label: `${account.code} - ${account.name}` }))
    ), [expenseAccounts]);

    const isBusy = createImport.isPending || updateImport.isPending || finalizeImport.isPending || sessionLoading;

    const recalculateReview = (nextReview: ReviewState): ReviewState => {
        const lines: BillImportLine[] = nextReview.lines.map((line, index) => {
            const quantity = toNumber(line.quantity);
            const price = toNumber(line.price);
            const lineTotal = quantity * price;
            const reviewStatus: BillImportLine['reviewStatus'] =
                line.description && (line.itemId || line.accountId) ? 'matched' : 'needs_review';

            return {
                ...line,
                lineNo: index + 1,
                quantity,
                price,
                lineTotal,
                reviewStatus,
            };
        });

        const subtotal = lines.reduce((sum, line) => sum + toNumber(line.lineTotal), 0);
        const taxAmount = toNumber(nextReview.taxAmount);
        const totalAmount = subtotal + taxAmount;
        const needsReviewCount = lines.filter((line) => line.reviewStatus !== 'matched').length
            + (!nextReview.vendorId || !nextReview.issueDate ? 1 : 0);

        return {
            ...nextReview,
            lines,
            subtotal,
            totalAmount,
            needsReviewCount,
            readyToImport: Boolean(nextReview.vendorId && nextReview.issueDate && lines.length > 0 && needsReviewCount === 0),
        };
    };

    const updateReview = (mutator: (current: ReviewState) => ReviewState) => {
        setReviewData((current) => recalculateReview(mutator(current)));
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError('');
        setSuccessMessage('');

        const payload = new FormData();
        payload.append('file', file);

        try {
            const created = await createImport.mutateAsync(payload);
            setSessionId(created.id);
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload supplier PDF.');
            setSessionId('');
            setReviewData(EMPTY_REVIEW);
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleSaveReview = async () => {
        if (!sessionId) return;
        setError('');
        try {
            const saved = recalculateReview(reviewData);
            setReviewData(saved);
            await updateImport.mutateAsync({ id: sessionId, reviewData: saved });
            setSuccessMessage('Import review saved.');
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Failed to save import review.');
        }
    };

    const handleFinalize = async () => {
        if (!sessionId) return;
        setError('');
        setSuccessMessage('');
        try {
            const finalReview = recalculateReview(reviewData);
            setReviewData(finalReview);
            const result = await finalizeImport.mutateAsync({ id: sessionId, reviewData: finalReview });
            setSuccessMessage(`Draft bill ${result.bill.number} created successfully.`);
            navigate(`/ap/bills/edit?billId=${result.bill.number}&mode=edit`);
        } catch (finalizeError) {
            setError(finalizeError instanceof Error ? finalizeError.message : 'Failed to create draft bill.');
        }
    };

    const handleAddLine = () => {
        updateReview((current) => ({
            ...current,
            lines: [
                ...current.lines,
                {
                    lineNo: current.lines.length + 1,
                    rawText: '',
                    supplierLabel: '',
                    supplierSku: '',
                    description: '',
                    quantity: 1,
                    unit: 'PCS',
                    price: 0,
                    lineTotal: 0,
                    itemId: '',
                    accountId: '',
                    itemSuggestion: null,
                    reviewStatus: 'needs_review' as const,
                },
            ],
        }));
    };

    const handleRemoveLine = (lineNo: number) => {
        updateReview((current) => ({
            ...current,
            lines: current.lines.filter((line) => line.lineNo !== lineNo),
        }));
    };

    const handleLineChange = (lineNo: number, field: keyof BillImportLine, value: unknown) => {
        updateReview((current) => ({
            ...current,
            lines: current.lines.map((line) => {
                if (line.lineNo !== lineNo) return line;

                if (field === 'itemId') {
                    const selectedItem = items.find((item) => item.id === value);
                    return {
                        ...line,
                        itemId: String(value ?? ''),
                        description: line.description || selectedItem?.name || '',
                        unit: selectedItem?.unit || line.unit || 'PCS',
                        accountId: (selectedItem as Record<string, unknown> | undefined)?.inventoryAccountId as string || line.accountId || '',
                    };
                }

                return {
                    ...line,
                    [field]: value,
                };
            }),
        }));
    };

    const reviewHint = reviewData.readyToImport
        ? 'All required fields are mapped. This import will create a draft bill only.'
        : 'Review the extracted fields and assign an item or account to every line before importing.';

    return (
        <FormPage
            title="Import Supplier PDF"
            subtitle="Upload a supplier invoice PDF, review the extracted data, and create a draft AP bill."
            backTo="/ap/bills"
            actions={(
                <div className="flex gap-2">
                    <Button
                        text="Save Review"
                        variant="secondary"
                        icon={<Save size={16} />}
                        onClick={handleSaveReview}
                        disabled={!sessionId || isBusy}
                    />
                    <Button
                        text="Create Draft Bill"
                        icon={isBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        onClick={handleFinalize}
                        disabled={!sessionId || isBusy || !reviewData.lines.length}
                    />
                </div>
            )}
        >
            <Card className="mb-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-lg font-semibold text-neutral-900">1. Upload PDF</div>
                        <p className="text-sm text-neutral-600">
                            Supplier PDFs stay attached to the imported bill for audit and traceability.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            className="hidden"
                            onChange={handleUpload}
                        />
                        <Button
                            text={createImport.isPending ? 'Uploading...' : 'Choose PDF'}
                            icon={createImport.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={createImport.isPending}
                        />
                    </div>
                </div>

                {session ? (
                    <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
                        <div className="font-semibold">{session.sourceFileName}</div>
                        <div className="mt-1">
                            Extraction status: <strong>{session.extractionStatus}</strong>
                            {' · '}
                            Review status: <strong>{reviewData.readyToImport ? 'READY_TO_IMPORT' : 'NEEDS_REVIEW'}</strong>
                        </div>
                    </div>
                ) : null}
            </Card>

            {error ? (
                <div className="mb-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                    {error}
                </div>
            ) : null}

            {successMessage ? (
                <div className="mb-4 rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">
                    {successMessage}
                </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_360px]">
                <Card>
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-lg font-semibold text-neutral-900">2. Review Extracted Bill</h2>
                            <p className="text-sm text-neutral-600">{reviewHint}</p>
                        </div>
                        <Button text="Add Line" variant="secondary" size="small" icon={<Plus size={14} />} onClick={handleAddLine} disabled={!sessionId} />
                    </div>

                    {!sessionId ? (
                        <div className="rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center text-sm text-neutral-500">
                            Upload a supplier PDF to start the import review.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {reviewData.lines.length === 0 ? (
                                <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                                    No line items were confidently extracted. Add the bill lines manually below and then import the draft.
                                </div>
                            ) : null}

                            {reviewData.lines.map((line) => (
                                <div key={line.lineNo} className="rounded-2xl border border-neutral-200 p-4">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <div>
                                            <div className="font-semibold text-neutral-900">Line {line.lineNo}</div>
                                            <div className="text-xs text-neutral-500">
                                                {line.reviewStatus === 'matched' ? 'Matched' : 'Needs review'}
                                                {line.itemSuggestion ? ` · ${line.itemSuggestion.reason}` : ''}
                                            </div>
                                        </div>
                                        <Button
                                            text="Remove"
                                            variant="tertiary"
                                            size="small"
                                            icon={<Trash2 size={14} />}
                                            onClick={() => handleRemoveLine(line.lineNo)}
                                        />
                                    </div>

                                    {line.rawText ? (
                                        <div className="mb-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                                            Source text: {line.rawText}
                                        </div>
                                    ) : null}

                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div>
                                            <label className="form-label">Supplier Label</label>
                                            <input
                                                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                                value={line.supplierLabel}
                                                onChange={(event) => handleLineChange(line.lineNo, 'supplierLabel', event.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="form-label">Description</label>
                                            <input
                                                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                                value={line.description}
                                                onChange={(event) => handleLineChange(line.lineNo, 'description', event.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="form-label">Qty</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.0001"
                                                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                                value={line.quantity}
                                                onChange={(event) => handleLineChange(line.lineNo, 'quantity', event.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="form-label">Unit</label>
                                            <input
                                                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                                value={line.unit}
                                                onChange={(event) => handleLineChange(line.lineNo, 'unit', event.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="form-label">Price</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                                value={line.price}
                                                onChange={(event) => handleLineChange(line.lineNo, 'price', event.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="form-label">Line Total</label>
                                            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                                                {formatIDR(line.lineTotal)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                                        <div>
                                            <label className="form-label">Match Item</label>
                                            <SearchableSelect
                                                options={itemOptions}
                                                value={line.itemId}
                                                onChange={(value) => handleLineChange(line.lineNo, 'itemId', value)}
                                                placeholder="Select item..."
                                            />
                                        </div>
                                        <div>
                                            <label className="form-label">Fallback Account</label>
                                            <SearchableSelect
                                                options={accountOptions}
                                                value={line.accountId}
                                                onChange={(value) => handleLineChange(line.lineNo, 'accountId', value)}
                                                placeholder="Select account..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <div className="space-y-4">
                    <Card>
                        <h2 className="text-lg font-semibold text-neutral-900 mb-4">Header Mapping</h2>
                        <div>
                            <label className="form-label">Vendor</label>
                            <SearchableSelect
                                options={vendorOptions}
                                value={reviewData.vendorId}
                                onChange={(value) => updateReview((current) => ({ ...current, vendorId: value }))}
                                placeholder="Select vendor..."
                            />
                            {reviewData.vendorSuggestion ? (
                                <div className="text-xs text-neutral-500 -mt-2 mb-3">
                                    Suggested: <strong>{reviewData.vendorSuggestion.label}</strong>
                                    {' · '}Confidence {Math.round(reviewData.vendorSuggestion.confidence * 100)}%
                                </div>
                            ) : null}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            <div>
                                <label className="form-label">Issue Date</label>
                                <input
                                    type="date"
                                    className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                    value={reviewData.issueDate}
                                    onChange={(event) => updateReview((current) => ({ ...current, issueDate: event.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="form-label">Due Date</label>
                                <input
                                    type="date"
                                    className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                    value={reviewData.dueDate}
                                    onChange={(event) => updateReview((current) => ({ ...current, dueDate: event.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="form-label">Tax Rate (%)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                    value={reviewData.taxRate}
                                    onChange={(event) => updateReview((current) => ({ ...current, taxRate: event.target.value as unknown as number }))}
                                />
                            </div>
                            <div>
                                <label className="form-label">Tax Amount</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                    value={reviewData.taxAmount}
                                    onChange={(event) => updateReview((current) => ({ ...current, taxAmount: event.target.value as unknown as number }))}
                                />
                            </div>
                        </div>

                        <div className="mt-3">
                            <label className="form-label">Notes</label>
                            <textarea
                                className="block min-h-28 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                value={reviewData.notes}
                                onChange={(event) => updateReview((current) => ({ ...current, notes: event.target.value }))}
                            />
                        </div>
                    </Card>

                    <Card>
                        <h2 className="text-lg font-semibold text-neutral-900 mb-4">Import Summary</h2>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-neutral-600">Subtotal</span>
                                <strong>{formatIDR(reviewData.subtotal)}</strong>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-neutral-600">Tax</span>
                                <strong>{formatIDR(reviewData.taxAmount)}</strong>
                            </div>
                            <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                                <span className="text-neutral-900 font-semibold">Total</span>
                                <strong>{formatIDR(reviewData.totalAmount)}</strong>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-neutral-700">
                                Needs review: <strong>{reviewData.needsReviewCount}</strong>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </FormPage>
    );
};

export default BillImport;
