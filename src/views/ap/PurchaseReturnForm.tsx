import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import SearchableSelect from '../../components/UI/SearchableSelect';

interface PurchaseReturnLine {
    lineKey:       string;
    itemId?:       string;
    description:   string;
    qtyPurchased:  number;
    qtyReturn:     number;
    unit:          string;
    price:         number;
}

interface PurchaseReturnData {
    returnNumber:    string;
    vendorId:        string;
    billId:          string;
    returnDate:      string;
    warehouseId:     string;
    apAccountId:     string;
    returnAccountId: string;
    taxAccountId:    string;
    applyTax:        boolean;
    taxIncluded:     boolean;
    taxRate:         number;
    reason:          string;
    notes:           string;
    lines:           PurchaseReturnLine[];
}
interface PurchaseReturnLineInput extends Partial<PurchaseReturnLine> {
    qty?: number;
}

type PurchaseReturnAccountField = 'apAccountId' | 'returnAccountId' | 'taxAccountId';
import StatusTag from '../../components/UI/StatusTag';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import ClosedPeriodBanner from '../../components/UI/ClosedPeriodBanner';
import NotePrintTemplate from '../../components/print/NotePrintTemplate';
import { useVendors, useBills } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useWarehouses, usePurchaseReturns, useCreatePurchaseReturn, useUpdatePurchaseReturn, usePurchaseReturnPreview } from '../../hooks/useReturns';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { resolveAccountDefaults } from '../../../lib/account-defaults';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { makeTabId } from '../../stores/workspace/types';
import { pendingNoteRecordId, pendingNotePath } from '../../stores/workspace/modules';
import { MoneyDecimal } from '../../../lib/money-decimal';

const buildReturnNo = (dateStr: string, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `PRN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const normalizeLine = (line: PurchaseReturnLineInput): PurchaseReturnLine => ({
    lineKey: line.lineKey || '',
    itemId: line.itemId || undefined,
    description: line.description || '',
    qtyPurchased: Number(line.qtyPurchased || line.qty || 0),
    qtyReturn: Number(line.qtyReturn || 0),
    unit: line.unit || 'PCS',
    price: Number(line.price || 0)
});

interface PurchaseReturnFormProps { recordId?: string; mode?: string; workspaceTabId?: string }

const PurchaseReturnForm = ({ recordId, mode: modeProp, workspaceTabId }: PurchaseReturnFormProps = {}) => {
    const navigate = useNavigate();
    const location = useLocation();
    // In the workspace, identity comes from the owning tab (props), not router state.
    const inWorkspace = workspaceTabId != null;
    const state = (inWorkspace
        ? { mode: modeProp ?? (recordId ? 'edit' : 'create'), returnId: recordId }
        : (location.state || {})) as { mode?: string; returnId?: string };
    const mode = state.mode || 'create';
    const isView = mode === 'view';

    const { data: vendorsData, isLoading: vendorsLoading } = useVendors();
    const vendors = vendorsData?.data ?? [];
    const { data: billsData, isLoading: billsLoading } = useBills();
    const bills = billsData?.data ?? [];
    const { data: prData, isLoading: purchaseReturnsLoading } = usePurchaseReturns();
    const purchaseReturns = prData?.data ?? [];
    const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const accountDefaultsConfig = useSettingsStore((s) => s.accountDefaults);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const createPurchaseReturnMutation = useCreatePurchaseReturn();
    const updatePurchaseReturnMutation = useUpdatePurchaseReturn();
    const { open } = useWorkspaceNav();
    const saveDraft = useWorkspaceStore((s) => s.saveDraft);
    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const resolvedAccountDefaults = useMemo(
        () => resolveAccountDefaults(chartOfAccounts, accountDefaultsConfig),
        [chartOfAccounts, accountDefaultsConfig]
    );

    const billItemTemplates = useMemo<Record<string, PurchaseReturnLineInput[]>>(() => {
        const map: Record<string, PurchaseReturnLineInput[]> = {};
        bills.forEach(bill => {
            if (bill.lines?.length) map[bill._id || bill.id] = bill.lines.map((l, index) => ({
                lineKey: l.id || `${bill.id}-${index + 1}`,
                itemId: l.itemId,
                description: String(l.description || ''),
                qty: Number(l.quantity || l.qty || 0),
                unit: String(l.unit || 'PCS'),
                price: Number(l.price || 0)
            }));
        });
        return map;
    }, [bills]);

    const [returnNumberingMode, setReturnNumberingMode] = useState('auto');
    const [returnData, setReturnData] = useState<PurchaseReturnData>({
        returnNumber: '',
        vendorId: '',
        billId: '',
        returnDate: new Date().toISOString().split('T')[0],
        warehouseId: '',
        apAccountId: '',
        returnAccountId: '',
        taxAccountId: '',
        applyTax: true,
        taxIncluded: false,
        taxRate: 11,
        reason: '',
        notes: '',
        lines: []
    });

    const accountMap = useMemo<Record<string, any>>(() => {
        return chartOfAccounts.reduce((map: Record<string, any>, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const apAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Liability');
    }, [chartOfAccounts]);

    const returnAccountOptions = useMemo(() => {
        return chartOfAccounts.filter(
            (account) =>
                account.isActive && account.isPostable && (account.type === 'Expense' || account.type === 'Asset')
        );
    }, [chartOfAccounts]);

    const taxAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, [chartOfAccounts]);

    const getAlreadyReturnedQty = (billId: string, lineKey: string) => {
        const bill = bills.find(item => (item._id || item.id) === billId);
        const aliases = bill?.lines.map((line, index) => [line.id, `${bill.id}-${index + 1}`, `${billId}-${index + 1}`])
            .find(keys => keys.includes(lineKey)) ?? [lineKey];
        return purchaseReturns
            .filter(ret => ret.billId === billId && ret.id !== state.returnId && ret.status !== 'Void')
            .flatMap(ret => ret.lines)
            .filter(line => aliases.includes(line.lineKey))
            .reduce((qty, line) => qty.plus(line.qtyReturn), new MoneyDecimal(0));
    };

    useEffect(() => {
        if (!state.returnId) return;
        const found = purchaseReturns.find((item) => item.id === state.returnId);
        if (!found) return;
        setReturnNumberingMode('manual');
        setReturnData({
            returnNumber: found.id,
            vendorId: found.vendorId,
            billId: found.billId,
            returnDate: found.returnDate,
            warehouseId: found.warehouseId,
            apAccountId: found.apAccountId || resolvedAccountDefaults.apControl,
            returnAccountId: found.returnAccountId || resolvedAccountDefaults.apReturn,
            taxAccountId: found.taxAccountId || resolvedAccountDefaults.apTax,
            applyTax: found.applyTax,
            taxIncluded: found.taxIncluded,
            taxRate: found.taxRate,
            reason: found.reason || '',
            notes: found.notes || '',
            lines: (found.lines || []).map(normalizeLine)
        });
    }, [state.returnId, purchaseReturns, resolvedAccountDefaults]);

    useEffect(() => {
        if (warehouses.length > 0 && !returnData.warehouseId) {
            setReturnData((prev) => ({ ...prev, warehouseId: prev.warehouseId || warehouses[0].id }));
        }
    }, [warehouses]);

    useEffect(() => {
        if (state.returnId) return;
        setReturnData((prev) => {
            let changed = false;
            const next = { ...prev };

            if (!next.apAccountId && resolvedAccountDefaults.apControl) {
                next.apAccountId = resolvedAccountDefaults.apControl;
                changed = true;
            }
            if (!next.returnAccountId && resolvedAccountDefaults.apReturn) {
                next.returnAccountId = resolvedAccountDefaults.apReturn;
                changed = true;
            }
            if (!next.taxAccountId && resolvedAccountDefaults.apTax) {
                next.taxAccountId = resolvedAccountDefaults.apTax;
                changed = true;
            }

            return changed ? next : prev;
        });
    }, [state.returnId, resolvedAccountDefaults]);

    const returnNoPreview = useMemo(() => buildReturnNo(returnData.returnDate, purchaseReturns.length + 1), [returnData.returnDate]);

    const vendorOptions = vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }));

    const billOptions = useMemo(() => {
        const filteredBills = bills.filter((bill) => !returnData.vendorId || bill.vendorId === returnData.vendorId);
        return filteredBills.map((bill) => ({
            value: bill._id || bill.id,
            label: `${bill.id} • ${bill.vendor} • ${formatDateID(bill.date)}`
        }));
    }, [returnData.vendorId, bills]);

    const previewEnabled = !isView && Boolean(returnData.billId && returnData.vendorId)
        && returnData.lines.some(line => line.qtyReturn > 0);
    const preview = usePurchaseReturnPreview({
        billId: returnData.billId, vendorId: returnData.vendorId, returnId: state.returnId,
        applyTax: returnData.applyTax, taxIncluded: returnData.taxIncluded, taxRate: returnData.taxRate, lines: returnData.lines,
    }, previewEnabled);
    const valuation = isView ? purchaseReturns.find(item => item.id === state.returnId) : preview.data;
    const totals = {
        subtotal: Number(valuation?.subtotal ?? 0),
        taxAmount: Number(valuation?.taxAmount ?? 0),
        total: Number(valuation?.totalAmount ?? 0),
        net: new MoneyDecimal(valuation?.totalAmount ?? 0).minus(valuation?.taxAmount ?? 0).toNumber(),
    };
    const previewUnavailable = previewEnabled && (!preview.data || preview.isError);

    const hydrateLinesFromBill = (billId: string): PurchaseReturnLine[] => {
        const template = billItemTemplates[billId] || [];
        return template.map((line: PurchaseReturnLineInput) => normalizeLine({
            lineKey: line.lineKey,
            itemId: line.itemId,
            description: line.description || '',
            qtyPurchased: line.qty,
            qtyReturn: 0,
            unit: line.unit,
            price: line.price
        }));
    };

    const handleBillChange = (billId: string) => {
        const foundBill = bills.find(item => (item._id || item.id) === billId);
        const vendor = vendors.find((item) => item.id === foundBill?.vendorId);
        setReturnData((prev) => ({
            ...prev,
            billId,
            vendorId: foundBill?.vendorId || prev.vendorId,
            apAccountId: vendor?.defaultApAccountId || prev.apAccountId,
            applyTax: foundBill?.taxable ?? false,
            taxIncluded: foundBill?.taxInclusive ?? false,
            taxRate: foundBill?.taxRate ?? 0,
            lines: hydrateLinesFromBill(billId)
        }));
    };

    const updateLine = (index: number, field: keyof PurchaseReturnLine, value: string | number) => {
        setReturnData((prev) => {
            const nextLines = [...prev.lines];
            const line: PurchaseReturnLine = { ...nextLines[index] };
            if (field === 'qtyReturn') {
                const parsed = Number(value || 0);
                const maxReturnableQty = new MoneyDecimal(line.qtyPurchased).minus(getAlreadyReturnedQty(prev.billId, line.lineKey));
                line.qtyReturn = MoneyDecimal.max(0, MoneyDecimal.min(new MoneyDecimal(parsed).toDecimalPlaces(4), maxReturnableQty)).toNumber();
            } else {
                (line as any)[field] = value;
            }
            nextLines[index] = line;
            return { ...prev, lines: nextLines };
        });
    };

    const formatAccountOption = (accountId: string) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId: string) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    const postingPreview = useMemo(() => {
        const lines = [
            { side: 'DR', accountId: returnData.apAccountId, amount: totals.total },
            { side: 'CR', accountId: returnData.returnAccountId, amount: totals.net }
        ];

        if (returnData.applyTax && totals.taxAmount > 0) {
            lines.push({ side: 'CR', accountId: returnData.taxAccountId, amount: totals.taxAmount });
        }

        return lines;
    }, [returnData.apAccountId, returnData.returnAccountId, returnData.taxAccountId, returnData.applyTax, totals.net, totals.taxAmount, totals.total]);

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';

    const renderAccountField = (label: string, key: PurchaseReturnAccountField, options: any[], disabled = false) => {
        if (isAccountLegacy(returnData[key])) {
            return (
                <div>
                    <label className="form-label">{label}</label>
                    <div className="journal-account-legacy">
                        <span>{formatAccountOption(returnData[key])}</span>
                        <span className="coa-state-badge coa-state-archived">Legacy / Inactive</span>
                    </div>
                </div>
            );
        }

        return (
            <div>
                <label className="form-label">{label}</label>
                <select
                    className={fcBase}
                    value={returnData[key]}
                    onChange={(event) => setReturnData((prev) => ({ ...prev, [key]: event.target.value }))}
                    disabled={isView || disabled}
                >
                    {options.map((account) => (
                        <option key={account.id} value={account.id}>
                            {account.code} - {account.name}
                        </option>
                    ))}
                </select>
            </div>
        );
    };

    const handleSaveReturn = async (saveAsDraft = false) => {
        if (!returnData.vendorId) {
            window.alert('Select a vendor before saving purchase return.');
            return;
        }

        if (!returnData.billId) {
            window.alert('Select a source bill before saving purchase return.');
            return;
        }

        const selectedLines = returnData.lines.filter((line) => Number(line.qtyReturn) > 0);
        if (selectedLines.length === 0) {
            window.alert('Set Qty Return for at least one line before creating debit note.');
            return;
        }
        if (previewUnavailable) return;

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0 && isAccountLegacy(line.accountId))
            .map((line) => formatAccountOption(line.accountId));
        if (invalidPostingAccounts.length > 0) {
            window.alert(`Cannot save purchase return. Posting account is inactive/legacy:\n- ${invalidPostingAccounts.join('\n- ')}`);
            return;
        }

        const returnNumber = returnNumberingMode === 'manual' ? returnData.returnNumber : undefined;
        const payload = {
            ...returnData,
            ...(returnNumber && { returnNumber }),
            lines: selectedLines,
            expectedValuation: preview.data && { totalAmount: preview.data.totalAmount, taxAmount: preview.data.taxAmount },
        };

        // Persist the return via API
        const returnRecord = {
            ...(returnNumber && { id: returnNumber }),
            ...payload,
            status: saveAsDraft ? 'Draft' as const : 'Pending Debit Note' as const,
        };
        // Await the write rather than firing and forgetting: the debit note has to
        // link to the SAVED return, and only the response carries the id and the
        // server-assigned number. It also means a failed save is reported instead
        // of silently swallowed while we navigate away.
        let saved;
        try {
            saved = state.returnId
                ? await updatePurchaseReturnMutation.mutateAsync({ ...returnRecord, id: state.returnId })
                : await createPurchaseReturnMutation.mutateAsync(returnRecord);
        } catch (err) {
            void preview.refetch();
            window.alert(`Failed to save purchase return: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return;
        }

        if (saveAsDraft) {
            // Drafts park the return without spawning a debit note.
            navigate('/ap/debits');
            return;
        }

        const savedId = saved?.id || state.returnId || '';
        const savedNumber = saved?.number || payload.returnNumber || '';
        // Seed with the canonical PurchaseReturn field names so the debit note can
        // read `id`/`number` straight off the draft.
        const returnSeed = { ...saved, returnDate: String(saved.returnDate ?? payload.returnDate).slice(0, 10), id: savedId, number: savedNumber };

        // Hand the prefilled debit note over through the new tab's draft. In the
        // workspace a route carries only a path string, so router `state` never
        // arrives — and `/ap/debits/new` on its own maps to the catalog, which
        // used to drop the user on the list with the draft gone.
        // Auto-numbered returns carry no identity yet — the server assigns the
        // number on save — so fall back to a per-save key. Two returns saved back
        // to back must not collide onto one debit note tab and overwrite each
        // other's draft; an edited return (which has an id) reuses its own tab.
        const returnKey = String(savedId || savedNumber || `draft-${Date.now().toString(36)}`);
        const noteTitle = savedNumber ? `Debit note · ${savedNumber}` : 'New debit note';
        if (inWorkspace) {
            const target = { module: 'ap', entity: 'debit-note', recordId: pendingNoteRecordId('debit', returnKey), mode: 'create' as const };
            const opened = open({
                kind: 'doc-form',
                target,
                title: noteTitle,
                path: pendingNotePath('debit', returnKey),
                initialStatus: 'new',
            });
            // Blocked by the tab cap: leave this return open so the cap prompt
            // has somewhere to return to.
            if (!opened) return;
            saveDraft(makeTabId(target), { returnDraft: returnSeed });
            if (workspaceTabId) closeTab(workspaceTabId);
            return;
        }

        navigate('/ap/debits/new', {
            state: {
                mode: 'create',
                source: 'purchase-return',
                returnDraft: returnSeed
            }
        });
    };

    const isPageLoading =
        vendorsLoading ||
        billsLoading ||
        purchaseReturnsLoading ||
        warehousesLoading ||
        chartOfAccountsLoading;

    return (
        <FormPage
            containerClassName="ap-module"
            title="Purchase Return"
            backTo="/ap/debits"
            isLoading={isPageLoading}
            actions={
                <>
                    <Button text="Print" variant="secondary" disabled={returnData.lines.length === 0 || previewUnavailable} onClick={() => setIsPrintOpen(true)} />
                    {!isView && <Button text="Save Draft" variant="secondary" disabled={previewUnavailable} onClick={() => { void handleSaveReturn(true); }} />}
                    <Button
                        text={isView ? 'Close' : 'Save & Create Debit Note'}
                        variant="primary"
                        disabled={previewUnavailable}
                        onClick={isView ? () => navigate('/ap/debits') : () => { void handleSaveReturn(false); }}
                    />
                </>
            }
        >
            <div className="module-status-strip">
                <div className="module-status-meta">
                    <div className="module-status-number">{returnData.returnNumber || 'Otomatis'}</div>
                    <StatusTag status={isView ? 'Completed' : 'Draft'} label={isView ? 'Approved' : 'Draft'} />
                </div>
                <div className="module-status-total">{previewUnavailable ? '—' : formatIDR(totals.total)}</div>
            </div>

            {!isView && <ClosedPeriodBanner date={returnData.returnDate} className="mb-4" />}
            {previewEnabled && preview.isError && <p role="alert" className="text-danger-600">{preview.error.message}</p>}
            {previewUnavailable && !preview.isError && <p role="status">Calculating return totals…</p>}

            <div className="invoice-panel panel-primary-top no-top-margin">
                <div className="grid-12 form-grid-tight">
                    <div className="col-span-4">
                        <label className="form-label">Vendor *</label>
                        <SearchableSelect
                            options={vendorOptions}
                            value={returnData.vendorId}
                            onChange={(value: string) => setReturnData((prev) => ({ ...prev, vendorId: value, billId: '', lines: [] }))}
                            placeholder="Select Vendor..."
                            disabled={isView}
                        />
                    </div>
                    <div className="col-span-4">
                        <label className="form-label">Source Bill *</label>
                        <SearchableSelect
                            options={billOptions}
                            value={returnData.billId}
                            onChange={handleBillChange}
                            placeholder="Select Bill..."
                            disabled={isView}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Return Date *</label>
                        <Input className="mb-0" type="date" value={returnData.returnDate} onChange={(event) => setReturnData((prev) => ({ ...prev, returnDate: event.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Warehouse *</label>
                        <select className={fcBase} value={returnData.warehouseId} onChange={(event) => setReturnData((prev) => ({ ...prev, warehouseId: event.target.value }))} disabled={isView}>
                            {warehouses.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>{String(warehouse.code)} - {warehouse.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="col-span-3">
                        <label className="form-label">Return #</label>
                        <div className="numbering-row">
                            <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={returnNumberingMode} onChange={(event) => setReturnNumberingMode(event.target.value)} disabled={isView}>
                                <option value="auto">Auto</option>
                                <option value="manual">Manual</option>
                            </select>
                            <Input className="mb-0" value={returnData.returnNumber} onChange={(event) => setReturnData((prev) => ({ ...prev, returnNumber: event.target.value }))} disabled={isView || returnNumberingMode === 'auto'} placeholder={returnNoPreview} />
                        </div>
                    </div>
                    <div className="col-span-3">
                        <label className="form-label">Tax</label>
                        <div className="tax-checkbox-row">
                            <label className="checkbox-inline">
                                <input type="checkbox" checked={returnData.applyTax} onChange={(event) => setReturnData((prev) => ({ ...prev, applyTax: event.target.checked }))} disabled={isView} />
                                Apply Tax
                            </label>
                            <label className="checkbox-inline">
                                <input type="checkbox" checked={returnData.taxIncluded} onChange={(event) => setReturnData((prev) => ({ ...prev, taxIncluded: event.target.checked }))} disabled={isView || !returnData.applyTax} />
                                Total includes tax
                            </label>
                        </div>
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Tax Rate (%)</label>
                        <Input className="mb-0" type="number" value={returnData.taxRate} onChange={(event) => setReturnData((prev) => ({ ...prev, taxRate: Number(event.target.value) }))} disabled={isView || !returnData.applyTax} />
                    </div>
                    <div className="col-span-4">
                        <label className="form-label">Reason</label>
                        <Input className="mb-0" value={returnData.reason} onChange={(event) => setReturnData((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Reason for return" disabled={isView} />
                    </div>

                    <div className="col-span-4">{renderAccountField('A/P Account (DR)', 'apAccountId', apAccountOptions)}</div>
                    <div className="col-span-4">{renderAccountField('Return Account (CR)', 'returnAccountId', returnAccountOptions)}</div>
                    <div className="col-span-4">{renderAccountField('Tax Account (CR)', 'taxAccountId', taxAccountOptions, !returnData.applyTax)}</div>
                </div>
            </div>

            <div className="invoice-panel panel-no-padding mt-12">
                <div className="panel-section-title">Returned Lines</div>
                <div className="panel-section-note">One purchase return links to one source bill. Set return quantity for partial returns.</div>
                <table className="module-table">
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th className="text-right">Qty Purchased</th>
                            <th className="text-right">Qty Return</th>
                            <th>Unit</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {returnData.lines.length === 0 ? (
                            <tr><td colSpan={6} className="module-empty-state">Select a bill to load line items.</td></tr>
                        ) : returnData.lines.map((line, idx) => (
                            <tr key={line.lineKey} className="row-border">
                                <td>{line.description}</td>
                                <td className="text-right">{line.qtyPurchased}</td>
                                <td className="compact text-right">
                                    <input
                                        type="number"
                                        className="w-full h-8 px-2 rounded border border-neutral-300 bg-neutral-0 text-sm text-right focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                        min={0}
                                        step="0.0001"
                                        max={MoneyDecimal.max(0, new MoneyDecimal(line.qtyPurchased).minus(getAlreadyReturnedQty(returnData.billId, line.lineKey))).toNumber()}
                                        value={line.qtyReturn}
                                        onChange={(event) => updateLine(idx, 'qtyReturn', event.target.value)}
                                        disabled={isView}
                                    />
                                </td>
                                <td>{line.unit}</td>
                                <td className="text-right">{formatIDR(line.price)}</td>
                                <td className="text-right text-strong">{previewUnavailable ? '—' : formatIDR(valuation?.lines[idx]?.lineTotal ?? 0)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="invoice-panel mt-12">
                <div className="grid-12 form-grid-start">
                    <div className="col-span-8">
                        <label className="form-label">Internal Notes</label>
                        <textarea className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed resize-y" rows={4} value={returnData.notes} onChange={(event) => setReturnData((prev) => ({ ...prev, notes: event.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-4 panel-box panel-box-tight">
                        <div className="panel-summary-row"><span>Subtotal</span><strong>{previewUnavailable ? '—' : formatIDR(totals.subtotal)}</strong></div>
                        <div className="panel-summary-row"><span>Tax ({returnData.applyTax ? `${returnData.taxRate}%` : '0%'})</span><strong>{previewUnavailable ? '—' : formatIDR(totals.taxAmount)}</strong></div>
                        <div className="panel-summary-total"><span className="label">Total Debit Basis</span><span className="value">{previewUnavailable ? '—' : formatIDR(totals.total)}</span></div>
                    </div>
                    <div className="col-span-12">
                        <div className="panel-box">
                            <div className="bill-posting-preview-title">Posting Preview</div>
                            <table className="bill-posting-table">
                                <thead>
                                    <tr>
                                        <th>Side</th>
                                        <th>Account</th>
                                        <th className="text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {postingPreview.map((line, index) => (
                                        <tr key={`${line.side}-${line.accountId}-${index}`}>
                                            <td>{line.side}</td>
                                            <td>
                                                {formatAccountOption(line.accountId)}
                                                {isAccountLegacy(line.accountId) ? <span className="coa-state-badge coa-state-archived posting-legacy-badge">Legacy / Inactive</span> : null}
                                            </td>
                                            <td className="text-right">{formatIDR(line.amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <PrintPreviewModal
                isOpen={isPrintOpen}
                onClose={() => setIsPrintOpen(false)}
                title="Purchase Return Print Preview"
                documentTitle={`PurchaseReturn_${returnData.returnNumber || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                <NotePrintTemplate
                    title="PURCHASE RETURN"
                    partyLabel="Vendor"
                    partyName={vendors.find((v) => v.id === returnData.vendorId)?.name}
                    document={{
                        number: returnData.returnNumber,
                        date: returnData.returnDate,
                        status: isView ? 'Posted' : 'Draft',
                        reference: returnData.billId,
                        notes: returnData.reason,
                    }}
                    lineItems={returnData.lines.map((line, index) => ({ ...line, lineTotal: valuation?.lines[index]?.lineTotal ?? 0 }))}
                    subtotal={totals.subtotal}
                    taxAmount={totals.taxAmount}
                    total={totals.total}
                    company={company}
                    options={printSettings}
                />
            </PrintPreviewModal>
        </FormPage>
    );
};

export default PurchaseReturnForm;
