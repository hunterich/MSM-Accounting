import React, { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import SearchableSelect from '../../components/UI/SearchableSelect';
import StatusTag from '../../components/UI/StatusTag';
import { formatIDR, formatDateID } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useReturnStore } from '../../stores/useReturnStore';
import { useCustomers, useInvoices } from '../../hooks/useAR';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useWarehouses, useSalesReturns, useCreateSalesReturn, useUpdateSalesReturn } from '../../hooks/useReturns';
import { useItems } from '../../hooks/useInventory';

const buildReturnNo = (dateStr, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `SRN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const normalizeLine = (line) => ({
    itemId: line.id || line.itemId,
    itemName: line.itemName || line.name,
    qtySold: Number(line.qty || line.qtySold || 0),
    qtyReturn: Number(line.qtyReturn || 0),
    unit: line.unit || 'PCS',
    price: Number(line.price || 0)
});

const SalesReturnForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const state = location.state || {};
    const mode = state.mode || 'create'; // create | view | edit
    const isView = mode === 'view';
    const { addSalesReturn, updateSalesReturn } = useReturnStore();

    const { data: customersData, isLoading: customersLoading } = useCustomers();
    const customers = customersData?.data ?? [];
    const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();
    const invoices = invoicesData?.data ?? [];
    const { data: srData, isLoading: salesReturnsLoading } = useSalesReturns();
    const salesReturns = srData?.data ?? [];
    const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const { data: productsData, isLoading: productsLoading } = useItems();
    const products = productsData?.data ?? [];
    const createSalesReturnMutation = useCreateSalesReturn();
    const updateSalesReturnMutation = useUpdateSalesReturn();

    const invoiceItemTemplates = useMemo(() => {
        const map = {};
        invoices.forEach(inv => {
            if (inv.lines?.length) map[inv.id] = inv.lines.map(l => ({
                id: l.id || l.itemId,
                itemName: l.description || l.itemName,
                qty: l.quantity,
                unit: l.unit || 'PCS',
                price: l.price
            }));
        });
        return map;
    }, [invoices]);

    const [returnNumberingMode, setReturnNumberingMode] = useState('auto');
    const [itemLookupOpen, setItemLookupOpen] = useState(false);
    const [lookupItemId, setLookupItemId] = useState('');
    const [returnData, setReturnData] = useState({
        returnNumber: '',
        customerId: '',
        invoiceId: '',
        returnDate: new Date().toISOString().split('T')[0],
        warehouseId: '',
        arAccountId: 'COA-1210',
        returnAccountId: 'COA-5300',
        taxAccountId: 'COA-2200',
        applyTax: true,
        taxIncluded: false,
        taxRate: 11,
        reason: '',
        notes: '',
        lines: []
    });

    useEffect(() => {
        if (!state.returnId) return;
        const found = salesReturns.find((ret) => ret.id === state.returnId);
        if (!found) return;
        setReturnNumberingMode('manual');
        setReturnData({
            returnNumber: found.id,
            customerId: found.customerId,
            invoiceId: found.invoiceId,
            returnDate: found.returnDate,
            warehouseId: found.warehouseId,
            arAccountId: found.arAccountId || 'COA-1210',
            returnAccountId: found.returnAccountId || 'COA-5300',
            taxAccountId: found.taxAccountId || 'COA-2200',
            applyTax: found.applyTax,
            taxIncluded: found.taxIncluded,
            taxRate: found.taxRate,
            reason: found.reason || '',
            notes: '',
            lines: (found.lines || []).map(normalizeLine)
        });
    }, [state.returnId, salesReturns]);

    useEffect(() => {
        if (warehouses.length > 0 && !returnData.warehouseId) {
            setReturnData((prev) => ({ ...prev, warehouseId: prev.warehouseId || warehouses[0].id }));
        }
    }, [warehouses]);

    const returnNoPreview = useMemo(() => buildReturnNo(returnData.returnDate, salesReturns.length + 1), [returnData.returnDate]);

    const invoiceOptions = useMemo(() => {
        const filteredInvoices = invoices.filter((inv) => !returnData.customerId || inv.customerId === returnData.customerId);
        return filteredInvoices.map((inv) => ({
            value: inv.id,
            label: `${inv.id} • ${inv.customerName} • ${formatDateID(inv.date)}`
        }));
    }, [returnData.customerId]);

    const customerOptions = customers.map((customer) => ({
        value: customer.id,
        label: customer.name
    }));
    const itemOptions = products.map((product) => ({
        value: product.id,
        label: `${product.id} • ${product.name}`
    }));

    const accountMap = useMemo(() => {
        return chartOfAccounts.reduce((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const arAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, [chartOfAccounts]);

    const returnAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Expense');
    }, [chartOfAccounts]);

    const taxAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Liability');
    }, [chartOfAccounts]);

    const getAlreadyReturnedQty = (invoiceId, itemId, excludeReturnId = state.returnId) => {
        return salesReturns
            .filter((ret) => ret.invoiceId === invoiceId)
            .filter((ret) => !excludeReturnId || ret.id !== excludeReturnId)
            .reduce((sum, ret) => {
                const line = (ret.lines || []).find((ln) => (ln.itemId || ln.id) === itemId);
                return sum + Number(line?.qtyReturn || 0);
            }, 0);
    };

    const invoiceCandidatesByItem = useMemo(() => {
        if (!lookupItemId || !returnData.customerId) return [];
        return invoices
            .filter((inv) => inv.customerId === returnData.customerId)
            .map((inv) => {
                const lines = invoiceItemTemplates[inv.id] || [];
                const line = lines.find((ln) => (ln.itemId || ln.id) === lookupItemId);
                if (!line) return null;
                const qtySold = Number(line.qty || line.qtySold || 0);
                const alreadyReturned = getAlreadyReturnedQty(inv.id, lookupItemId, state.returnId);
                const remainingQty = Math.max(0, qtySold - alreadyReturned);
                return {
                    invoiceId: inv.id,
                    customerName: inv.customerName,
                    date: inv.date,
                    qtySold,
                    alreadyReturned,
                    remainingQty
                };
            })
            .filter(Boolean)
            .filter((cand) => cand.remainingQty > 0)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [lookupItemId, returnData.customerId]);

    const totals = useMemo(() => {
        const subtotal = returnData.lines.reduce((sum, line) => sum + (line.qtyReturn * line.price), 0);
        const taxRate = Number(returnData.taxRate || 0) / 100;
        let taxAmount = 0;
        let total = subtotal;

        if (returnData.applyTax) {
            if (returnData.taxIncluded) {
                const base = subtotal / (1 + taxRate);
                taxAmount = subtotal - base;
                total = subtotal;
            } else {
                taxAmount = subtotal * taxRate;
                total = subtotal + taxAmount;
            }
        }

        return {
            subtotal,
            taxAmount,
            total
        };
    }, [returnData.lines, returnData.applyTax, returnData.taxIncluded, returnData.taxRate]);

    const formatAccountOption = (accountId) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    const postingPreview = useMemo(() => {
        const lines = [
            {
                side: 'DR',
                accountId: returnData.returnAccountId,
                amount: totals.subtotal
            }
        ];

        if (returnData.applyTax && totals.taxAmount > 0) {
            lines.push({
                side: 'DR',
                accountId: returnData.taxAccountId,
                amount: totals.taxAmount
            });
        }

        lines.push({
            side: 'CR',
            accountId: returnData.arAccountId,
            amount: totals.total
        });

        return lines;
    }, [
        returnData.returnAccountId,
        returnData.taxAccountId,
        returnData.arAccountId,
        returnData.applyTax,
        totals.subtotal,
        totals.taxAmount,
        totals.total
    ]);
    const isPageLoading =
        customersLoading ||
        invoicesLoading ||
        salesReturnsLoading ||
        warehousesLoading ||
        chartOfAccountsLoading ||
        productsLoading;

    const hydrateLinesFromInvoice = (invoiceId) => {
        const template = invoiceItemTemplates[invoiceId] || [];
        return template.map((line) => normalizeLine({ ...line, qtyReturn: 0 }));
    };

    const handleInvoiceChange = (invoiceId) => {
        const inv = invoices.find((item) => item.id === invoiceId);
        setReturnData((prev) => ({
            ...prev,
            invoiceId,
            customerId: inv ? inv.customerId : prev.customerId,
            lines: hydrateLinesFromInvoice(invoiceId)
        }));
    };

    const updateLine = (index, field, value) => {
        setReturnData((prev) => {
            const nextLines = [...prev.lines];
            const line = { ...nextLines[index] };
            if (field === 'qtyReturn') {
                const parsed = Number(value || 0);
                const alreadyReturned = getAlreadyReturnedQty(prev.invoiceId, line.itemId, state.returnId);
                const maxReturnableQty = Math.max(0, Number(line.qtySold || 0) - alreadyReturned);
                line.qtyReturn = Math.max(0, Math.min(parsed, maxReturnableQty));
            } else {
                line[field] = value;
            }
            nextLines[index] = line;
            return { ...prev, lines: nextLines };
        });
    };

    const handleSaveReturn = () => {
        if (!returnData.customerId) {
            window.alert('Select a customer before saving sales return.');
            return;
        }

        if (!returnData.invoiceId) {
            window.alert('Select a source invoice before saving sales return.');
            return;
        }

        const selectedLines = returnData.lines.filter((line) => Number(line.qtyReturn) > 0);
        if (selectedLines.length === 0) {
            window.alert('Set Qty Return for at least one item before creating credit note.');
            return;
        }

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0 && isAccountLegacy(line.accountId))
            .map((line) => formatAccountOption(line.accountId));
        if (invalidPostingAccounts.length > 0) {
            window.alert(
                `Cannot save sales return. Posting account is inactive/legacy:\n- ${invalidPostingAccounts.join('\n- ')}`
            );
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
            status: 'Pending Credit Note',
        };
        if (state.returnId) {
            updateSalesReturnMutation.mutate({ id: state.returnId, ...returnRecord });
        } else {
            createSalesReturnMutation.mutate(returnRecord);
        }

        navigate('/ar/credits/new', {
            state: {
                mode: 'create',
                source: 'sales-return',
                returnDraft: payload
            }
        });
    };

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';

    const renderAccountField = (label, key, options, disabled = false) => {
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

    return (
        <FormPage
            containerClassName="ar-module"
            title="Sales Return"
            backTo="/ar/credits"
            isLoading={isPageLoading}
            actions={(
                <>
                    <Button text="Print" variant="secondary" />
                    <Button text="Save Draft" variant="secondary" />
                    <Button text={isView ? 'Close' : 'Save & Create Credit Note'} variant="primary" onClick={isView ? () => navigate('/ar/credits') : handleSaveReturn} />
                </>
            )}
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
                        <label className="form-label">Customer *</label>
                        <SearchableSelect options={customerOptions} value={returnData.customerId} onChange={(value) => setReturnData((prev) => ({ ...prev, customerId: value, invoiceId: '', lines: [] }))} placeholder="Select Customer..." disabled={isView} />
                    </div>
                    <div className="col-span-4">
                        <div className="source-invoice-head">
                            <label className="form-label source-invoice-label">Source Invoice *</label>
                            <button
                                type="button"
                                className="h-7 px-2 text-xs text-primary-700 bg-transparent rounded hover:bg-primary-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => setItemLookupOpen((prev) => !prev)}
                                disabled={isView || !returnData.customerId}
                            >
                                Find by Item
                            </button>
                        </div>
                        <SearchableSelect options={invoiceOptions} value={returnData.invoiceId} onChange={handleInvoiceChange} placeholder="Select Invoice..." disabled={isView} />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Return Date *</label>
                        <Input className="mb-0" type="date" value={returnData.returnDate} onChange={(e) => setReturnData((prev) => ({ ...prev, returnDate: e.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Warehouse *</label>
                        <select className={fcBase} value={returnData.warehouseId} onChange={(e) => setReturnData((prev) => ({ ...prev, warehouseId: e.target.value }))} disabled={isView}>
                            {warehouses.map((wh) => (
                                <option key={wh.id} value={wh.id}>{`${wh.code} - ${wh.name}`}</option>
                            ))}
                        </select>
                    </div>

                    <div className="col-span-3">
                        <label className="form-label">Return #</label>
                        <div className="numbering-row">
                            <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={returnNumberingMode} onChange={(e) => setReturnNumberingMode(e.target.value)} disabled={isView}>
                                <option value="auto">Auto</option>
                                <option value="manual">Manual</option>
                            </select>
                            <Input className="mb-0" value={returnData.returnNumber} onChange={(e) => setReturnData((prev) => ({ ...prev, returnNumber: e.target.value }))} disabled={isView || returnNumberingMode === 'auto'} placeholder={returnNoPreview} />
                        </div>
                    </div>
                    <div className="col-span-3">
                        <label className="form-label">Tax</label>
                        <div className="tax-checkbox-row">
                            <label className="checkbox-inline">
                                <input type="checkbox" checked={returnData.applyTax} onChange={(e) => setReturnData((prev) => ({ ...prev, applyTax: e.target.checked }))} disabled={isView} />
                                Apply Tax
                            </label>
                            <label className="checkbox-inline">
                                <input type="checkbox" checked={returnData.taxIncluded} onChange={(e) => setReturnData((prev) => ({ ...prev, taxIncluded: e.target.checked }))} disabled={isView || !returnData.applyTax} />
                                Total includes tax
                            </label>
                        </div>
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Tax Rate (%)</label>
                        <Input className="mb-0" type="number" value={returnData.taxRate} onChange={(e) => setReturnData((prev) => ({ ...prev, taxRate: Number(e.target.value) }))} disabled={isView || !returnData.applyTax} />
                    </div>
                    <div className="col-span-4">
                        <label className="form-label">Reason</label>
                        <Input className="mb-0" value={returnData.reason} onChange={(e) => setReturnData((prev) => ({ ...prev, reason: e.target.value }))} placeholder="Reason for return" disabled={isView} />
                    </div>
                    <div className="col-span-4">
                        {renderAccountField('Return Account (DR)', 'returnAccountId', returnAccountOptions)}
                    </div>
                    <div className="col-span-4">
                        {renderAccountField('A/R Account (CR)', 'arAccountId', arAccountOptions)}
                    </div>
                    <div className="col-span-4">
                        {renderAccountField('Tax Account (DR)', 'taxAccountId', taxAccountOptions, !returnData.applyTax)}
                    </div>
                </div>

                {itemLookupOpen && !isView && (
                    <div className="panel-box mt-12">
                        <div className="grid-12 form-grid-tight">
                            <div className="col-span-4">
                                <label className="form-label">Find Invoice by Item</label>
                                <SearchableSelect
                                    options={itemOptions}
                                    value={lookupItemId}
                                    onChange={setLookupItemId}
                                    placeholder="Search item SKU/name..."
                                />
                            </div>
                            <div className="col-span-8 lookup-helper-text">
                                Choose an item to see invoices for this customer that contain the item. Then click `Use`.
                            </div>
                        </div>

                        {lookupItemId && (
                            <div className="panel-table-wrap mt-8 bordered">
                                <table className="module-table">
                                    <thead>
                                        <tr>
                                            <th>Invoice #</th>
                                            <th>Date</th>
                                            <th className="text-right">Qty Sold</th>
                                            <th className="text-right">Already Returned</th>
                                            <th className="text-right">Remaining</th>
                                            <th className="text-right"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoiceCandidatesByItem.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="module-empty-state">
                                                    No matching invoice found for selected item.
                                                </td>
                                            </tr>
                                        ) : (
                                            invoiceCandidatesByItem.map((cand) => (
                                                <tr key={cand.invoiceId} className="row-border">
                                                    <td>{cand.invoiceId}</td>
                                                    <td>{formatDateID(cand.date)}</td>
                                                    <td className="text-right">{cand.qtySold}</td>
                                                    <td className="text-right">{cand.alreadyReturned}</td>
                                                    <td className="text-right text-strong">{cand.remainingQty}</td>
                                                    <td className="text-right">
                                                        <Button
                                                            text="Use"
                                                            size="small"
                                                            variant="tertiary"
                                                            onClick={() => {
                                                                handleInvoiceChange(cand.invoiceId);
                                                                setItemLookupOpen(false);
                                                            }}
                                                        />
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="invoice-panel panel-no-padding mt-12">
                <div className="panel-section-title">Returned Items</div>
                <div className="panel-section-note">
                    One sales return links to one source invoice. For partial return, input only the returned quantity. Lines with quantity `0` are ignored.
                </div>
                <table className="module-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th className="text-right">Qty Sold</th>
                            <th className="text-right">Qty Return</th>
                            <th>Unit</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {returnData.lines.length === 0 && (
                            <tr>
                                <td colSpan={6} className="module-empty-state">
                                    Select an invoice to load item lines.
                                </td>
                            </tr>
                        )}
                        {returnData.lines.map((line, idx) => (
                            <tr key={`${line.itemId}-${idx}`} className="row-border">
                                <td>{line.itemName}</td>
                                <td className="text-right">{line.qtySold}</td>
                                <td className="compact text-right">
                                    <input
                                        type="number"
                                        className="w-full h-8 px-2 rounded border border-neutral-300 bg-neutral-0 text-sm text-right focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                        min={0}
                                        max={Math.max(0, Number(line.qtySold || 0) - getAlreadyReturnedQty(returnData.invoiceId, line.itemId, state.returnId))}
                                        value={line.qtyReturn}
                                        onChange={(e) => updateLine(idx, 'qtyReturn', e.target.value)}
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
                        <textarea className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed resize-y" rows={4} value={returnData.notes} onChange={(e) => setReturnData((prev) => ({ ...prev, notes: e.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-4 panel-box panel-box-tight">
                        <div className="panel-summary-row">
                            <span>Subtotal</span>
                            <strong>{formatIDR(totals.subtotal)}</strong>
                        </div>
                        <div className="panel-summary-row">
                            <span>Tax ({returnData.applyTax ? `${returnData.taxRate}%` : '0%'})</span>
                            <strong>{formatIDR(returnData.applyTax ? totals.taxAmount : 0)}</strong>
                        </div>
                        <div className="panel-summary-total">
                            <span className="label">Total Credit Basis</span>
                            <span className="value">{formatIDR(totals.total)}</span>
                        </div>
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
                                    {postingPreview.map((line, idx) => (
                                        <tr key={`${line.side}-${line.accountId}-${idx}`}>
                                            <td>{line.side}</td>
                                            <td>
                                                {formatAccountOption(line.accountId)}
                                                {isAccountLegacy(line.accountId) ? (
                                                    <span className="coa-state-badge coa-state-archived posting-legacy-badge">Legacy / Inactive</span>
                                                ) : null}
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

export default SalesReturnForm;
