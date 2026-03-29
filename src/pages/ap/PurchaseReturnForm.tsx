import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import SearchableSelect from '../../components/UI/SearchableSelect';
import type { Account } from '../../types';

interface PurchaseReturnLine {
    lineKey:       string;
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
import StatusTag from '../../components/UI/StatusTag';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useReturnStore } from '../../stores/useReturnStore';
import { useVendors, useBills } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useWarehouses, usePurchaseReturns, useCreatePurchaseReturn, useUpdatePurchaseReturn } from '../../hooks/useReturns';

const buildReturnNo = (dateStr: string, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `PRN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const normalizeLine = (line: Partial<PurchaseReturnLine> & { qty?: number }) => ({
    lineKey: line.lineKey,
    description: line.description,
    qtyPurchased: Number(line.qtyPurchased || line.qty || 0),
    qtyReturn: Number(line.qtyReturn || 0),
    unit: line.unit || 'PCS',
    price: Number(line.price || 0)
});

const PurchaseReturnForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const state = location.state || {};
    const mode = state.mode || 'create';
    const isView = mode === 'view';
    const { addPurchaseReturn, updatePurchaseReturn } = useReturnStore();

    const { data: vendorsData, isLoading: vendorsLoading } = useVendors();
    const vendors = vendorsData?.data ?? [];
    const { data: billsData, isLoading: billsLoading } = useBills();
    const bills = billsData?.data ?? [];
    const { data: prData, isLoading: purchaseReturnsLoading } = usePurchaseReturns();
    const purchaseReturns = prData?.data ?? [];
    const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const createPurchaseReturnMutation = useCreatePurchaseReturn();
    const updatePurchaseReturnMutation = useUpdatePurchaseReturn();

    const billItemTemplates = useMemo(() => {
        const map: Record<string, { description: string; qty: number; unit: string; price: number }[]> = {};
        bills.forEach(bill => {
            if (bill.lines?.length) map[bill.id] = bill.lines.map(l => ({
                description: l.description,
                qty: l.quantity || l.qty,
                unit: l.unit || 'PCS',
                price: l.price
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
        apAccountId: 'COA-2100',
        returnAccountId: 'COA-5300',
        taxAccountId: 'COA-1210',
        applyTax: true,
        taxIncluded: false,
        taxRate: 11,
        reason: '',
        notes: '',
        lines: []
    });

    const accountMap = useMemo(() => {
        return chartOfAccounts.reduce<Record<string, Account>>((map, account) => {
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

    const toLineIdentity = (line: PurchaseReturnLine) => line.lineKey || `${line.description}|${line.unit}|${Number(line.price || 0)}`;

    const getAlreadyReturnedQty = (billId: string, lineIdentity: string, excludeReturnId?: string) => {
        return purchaseReturns
            .filter((ret) => ret.billId === billId)
            .filter((ret) => !excludeReturnId || ret.id !== excludeReturnId)
            .reduce((sum, ret) => {
                const matched = (ret.lines || []).find((line) => toLineIdentity(line) === lineIdentity);
                return sum + Number(matched?.qtyReturn || 0);
            }, 0);
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
            apAccountId: found.apAccountId || 'COA-2100',
            returnAccountId: found.returnAccountId || 'COA-5300',
            taxAccountId: found.taxAccountId || 'COA-1210',
            applyTax: found.applyTax,
            taxIncluded: found.taxIncluded,
            taxRate: found.taxRate,
            reason: found.reason || '',
            notes: found.notes || '',
            lines: (found.lines || []).map(normalizeLine)
        });
    }, [state.returnId, purchaseReturns]);

    useEffect(() => {
        if (warehouses.length > 0 && !returnData.warehouseId) {
            setReturnData((prev) => ({ ...prev, warehouseId: prev.warehouseId || warehouses[0].id }));
        }
    }, [warehouses]);

    const returnNoPreview = useMemo(() => buildReturnNo(returnData.returnDate, purchaseReturns.length + 1), [returnData.returnDate]);

    const vendorOptions = vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }));

    const billOptions = useMemo(() => {
        const filteredBills = bills.filter((bill) => !returnData.vendorId || bill.vendorId === returnData.vendorId);
        return filteredBills.map((bill) => ({
            value: bill.id,
            label: `${bill.id} • ${bill.vendor} • ${formatDateID(bill.date)}`
        }));
    }, [returnData.vendorId]);

    const totals = useMemo(() => {
        const subtotal = returnData.lines.reduce((sum, line) => sum + line.qtyReturn * line.price, 0);
        const rate = Number(returnData.taxRate || 0) / 100;
        let taxAmount = 0;
        let total = subtotal;

        if (returnData.applyTax) {
            if (returnData.taxIncluded) {
                const base = subtotal / (1 + rate);
                taxAmount = subtotal - base;
                total = subtotal;
            } else {
                taxAmount = subtotal * rate;
                total = subtotal + taxAmount;
            }
        }

        return { subtotal, taxAmount, total };
    }, [returnData.lines, returnData.applyTax, returnData.taxIncluded, returnData.taxRate]);

    const hydrateLinesFromBill = (billId: string): PurchaseReturnLine[] => {
        const template = billItemTemplates[billId] || [];
        return template.map((line, index) => normalizeLine({
            lineKey: `${billId}-${index + 1}`,
            description: line.description,
            qtyPurchased: line.qty,
            qtyReturn: 0,
            unit: line.unit,
            price: line.price
        }));
    };

    const handleBillChange = (billId: string) => {
        const foundBill = bills.find((item) => item.id === billId);
        const vendor = vendors.find((item) => item.id === foundBill?.vendorId);
        setReturnData((prev) => ({
            ...prev,
            billId,
            vendorId: foundBill?.vendorId || prev.vendorId,
            apAccountId: vendor?.defaultApAccountId || prev.apAccountId,
            lines: hydrateLinesFromBill(billId)
        }));
    };

    const updateLine = (index: number, field: keyof PurchaseReturnLine, value: string | number) => {
        setReturnData((prev) => {
            const nextLines = [...prev.lines];
            const line = { ...nextLines[index] };
            if (field === 'qtyReturn') {
                const parsed = Number(value || 0);
                const lineIdentity = toLineIdentity(line);
                const alreadyReturned = getAlreadyReturnedQty(prev.billId, lineIdentity, state.returnId);
                const maxReturnableQty = Math.max(0, Number(line.qtyPurchased || 0) - alreadyReturned);
                line.qtyReturn = Math.max(0, Math.min(parsed, maxReturnableQty));
            } else {
                (line as Record<string, unknown>)[field] = value;
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
            { side: 'CR', accountId: returnData.returnAccountId, amount: totals.subtotal }
        ];

        if (returnData.applyTax && totals.taxAmount > 0) {
            lines.push({ side: 'CR', accountId: returnData.taxAccountId, amount: totals.taxAmount });
        }

        return lines;
    }, [returnData.apAccountId, returnData.returnAccountId, returnData.taxAccountId, returnData.applyTax, totals.subtotal, totals.taxAmount, totals.total]);

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';

    const renderAccountField = (label: string, key: 'apAccountId' | 'returnAccountId' | 'taxAccountId', options: Account[], disabled = false) => {
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

    const handleSaveReturn = () => {
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
            lines: selectedLines
        };

        // Persist the return via API
        const returnRecord = {
            ...(returnNumber && { id: returnNumber }),
            ...payload,
            status: 'Pending Debit Note',
        };
        if (state.returnId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            updatePurchaseReturnMutation.mutate({ id: state.returnId, ...returnRecord } as any);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            createPurchaseReturnMutation.mutate(returnRecord as any);
        }

        navigate('/ap/debits/new', {
            state: {
                mode: 'create',
                source: 'purchase-return',
                returnDraft: payload
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
                    <Button text="Print" variant="secondary" />
                    <Button text="Save Draft" variant="secondary" />
                    <Button
                        text={isView ? 'Close' : 'Save & Create Debit Note'}
                        variant="primary"
                        onClick={isView ? () => navigate('/ap/debits') : handleSaveReturn}
                    />
                </>
            }
        >
            <div className="module-status-strip">
                <div className="module-status-meta">
                    <div className="module-status-number">{returnData.returnNumber || 'Otomatis'}</div>
                    <StatusTag status={isView ? 'Completed' : 'Draft'} label={isView ? 'Approved' : 'Draft'} />
                </div>
                <div className="module-status-total">{formatIDR(totals.total)}</div>
            </div>

            <div className="invoice-panel panel-primary-top no-top-margin">
                <div className="grid-12 form-grid-tight">
                    <div className="col-span-4">
                        <label className="form-label">Vendor *</label>
                        <SearchableSelect
                            options={vendorOptions}
                            value={returnData.vendorId}
                            onChange={(value) => setReturnData((prev) => ({ ...prev, vendorId: value, billId: '', lines: [] }))}
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
                                <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
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
                                        max={Math.max(0, Number(line.qtyPurchased || 0) - getAlreadyReturnedQty(returnData.billId, toLineIdentity(line), state.returnId))}
                                        value={line.qtyReturn}
                                        onChange={(event) => updateLine(idx, 'qtyReturn', event.target.value)}
                                        disabled={isView}
                                    />
                                </td>
                                <td>{line.unit}</td>
                                <td className="text-right">{formatIDR(line.price)}</td>
                                <td className="text-right text-strong">{formatIDR(line.qtyReturn * line.price)}</td>
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
                        <div className="panel-summary-row"><span>Subtotal</span><strong>{formatIDR(totals.subtotal)}</strong></div>
                        <div className="panel-summary-row"><span>Tax ({returnData.applyTax ? `${returnData.taxRate}%` : '0%'})</span><strong>{formatIDR(returnData.applyTax ? totals.taxAmount : 0)}</strong></div>
                        <div className="panel-summary-total"><span className="label">Total Debit Basis</span><span className="value">{formatIDR(totals.total)}</span></div>
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
        </FormPage>
    );
};

export default PurchaseReturnForm;
