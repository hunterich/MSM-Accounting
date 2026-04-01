import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import SearchableSelect from '../../components/UI/SearchableSelect';
import StatusTag from '../../components/UI/StatusTag';
import { formatIDR, formatDateID } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useCustomers, useInvoices } from '../../hooks/useAR';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useWarehouses, useSalesReturns, useCreateSalesReturn, useUpdateSalesReturn } from '../../hooks/useReturns';
import { useItems } from '../../hooks/useInventory';
import type { Account, InventoryItem, Invoice, InvoiceLine, SalesReturn as SalesReturnRecord, Warehouse } from '../../types';

interface SalesReturnLine {
    itemId:    string;
    itemName:  string;
    qtySold:   number;
    qtyReturn: number;
    unit:      string;
    price:     number;
}

interface SalesReturnData {
    returnNumber:    string;
    customerId:      string;
    invoiceId:       string;
    returnDate:      string;
    warehouseId:     string;
    arAccountId:     string;
    returnAccountId: string;
    taxAccountId:    string;
    applyTax:        boolean;
    taxIncluded:     boolean;
    taxRate:         number;
    reason:          string;
    notes:           string;
    lines:           SalesReturnLine[];
}

interface InvoiceTemplateLine {
    itemId:   string;
    itemName: string;
    qtySold:  number;
    unit:     string;
    price:    number;
}

interface InvoiceCandidate {
    invoiceId:        string;
    customerName:     string;
    date:             string;
    qtySold:          number;
    alreadyReturned:  number;
    remainingQty:     number;
}

type ReturnMode = 'create' | 'view' | 'edit';
type ReturnNumberingMode = 'auto' | 'manual';
type SalesReturnAccountKey = 'arAccountId' | 'returnAccountId' | 'taxAccountId';
type PostingLine = { side: 'DR' | 'CR'; accountId: string; amount: number };
type SalesReturnRouteState = { mode?: ReturnMode; returnId?: string };

const buildReturnNo = (dateStr: string, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `SRN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const normalizeLine = (
    line: Partial<SalesReturnLine> & { id?: string; itemId?: string; itemName?: string; qty?: number | string; qtySold?: number | string; qtyReturn?: number | string; unit?: string; price?: number | string }
): SalesReturnLine => ({
    itemId: String(line.itemId || line.id || ''),
    itemName: line.itemName || 'Item',
    qtySold: Number(line.qtySold || line.qty || 0),
    qtyReturn: Number(line.qtyReturn || 0),
    unit: line.unit || 'PCS',
    price: Number(line.price || 0)
});

const getInvoiceLineItemId = (line: InvoiceLine) => String(line.itemId || line.id || line.code || '');
const getInvoiceLineItemName = (line: InvoiceLine) => line.description || line.itemName || line.code || 'Item';

const formatWarehouseLabel = (warehouse: Warehouse) => {
    const code = typeof warehouse.code === 'string' ? warehouse.code : '';
    const name = typeof warehouse.name === 'string' ? warehouse.name : '';
    return [code, name].filter(Boolean).join(' - ') || warehouse.id;
};

const SalesReturnForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const state = (location.state as SalesReturnRouteState | null) || {};
    const mode: ReturnMode = state.mode || 'create';
    const isView = mode === 'view';

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

    const invoiceItemTemplates = useMemo<Record<string, InvoiceTemplateLine[]>>(() => {
        const map: Record<string, InvoiceTemplateLine[]> = {};
        invoices.forEach((inv: Invoice) => {
            const sourceLines = inv.lines?.length ? inv.lines : inv.items || [];
            if (!sourceLines.length) return;
            map[inv.id] = sourceLines.map((line) => ({
                itemId: getInvoiceLineItemId(line),
                itemName: getInvoiceLineItemName(line),
                qtySold: Number(line.quantity || 0),
                unit: line.unit || 'PCS',
                price: Number(line.price || 0)
            }));
        });
        return map;
    }, [invoices]);

    const [returnNumberingMode, setReturnNumberingMode] = useState<ReturnNumberingMode>('auto');
    const [itemLookupOpen, setItemLookupOpen] = useState(false);
    const [lookupItemId, setLookupItemId] = useState('');
    const [returnData, setReturnData] = useState<SalesReturnData>({
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

    const accountMap = useMemo<Record<string, Account>>(() => {
        return chartOfAccounts.reduce<Record<string, Account>>((map, account) => {
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

    const getAlreadyReturnedQty = (invoiceId: string, itemId: string, excludeReturnId = state.returnId) => {
        return salesReturns
            .filter((ret) => ret.invoiceId === invoiceId)
            .filter((ret) => !excludeReturnId || ret.id !== excludeReturnId)
            .reduce((sum, ret) => {
                const line = (ret.lines || []).find((entry) => entry.itemId === itemId);
                return sum + Number(line?.qtyReturn || 0);
            }, 0);
    };

    useEffect(() => {
        if (!state.returnId) return;
        const found = salesReturns.find((ret) => ret.id === state.returnId);
        if (!found) return;
        setReturnNumberingMode('manual');
        setReturnData({
            returnNumber: found.number || found.id,
            customerId: found.customerId,
            invoiceId: found.invoiceId,
            returnDate: found.returnDate,
            warehouseId: found.warehouseId,
            arAccountId: found.arAccountId || 'COA-1210',
            returnAccountId: found.returnAccountId || 'COA-5300',
            taxAccountId: found.taxAccountId || 'COA-2200',
            applyTax: found.applyTax,
            taxIncluded: found.taxIncluded,
            taxRate: Number(found.taxRate || 11),
            reason: found.reason || '',
            notes: found.notes || '',
            lines: (found.lines || []).map(normalizeLine)
        });
    }, [state.returnId, salesReturns]);

    useEffect(() => {
        if (warehouses.length > 0 && !returnData.warehouseId) {
            setReturnData((prev) => ({ ...prev, warehouseId: prev.warehouseId || warehouses[0].id }));
        }
    }, [warehouses, returnData.warehouseId]);

    const returnNoPreview = useMemo(() => buildReturnNo(returnData.returnDate, salesReturns.length + 1), [returnData.returnDate, salesReturns.length]);

    const invoiceOptions = useMemo(() => {
        const filteredInvoices = invoices.filter((inv) => !returnData.customerId || inv.customerId === returnData.customerId);
        return filteredInvoices.map((inv) => ({
            value: inv.id,
            label: `${inv.id} • ${inv.customerName} • ${formatDateID(inv.date)}`
        }));
    }, [returnData.customerId, invoices]);

    const customerOptions = useMemo(() => {
        return customers.map((customer) => ({
            value: customer.id,
            label: customer.name
        }));
    }, [customers]);

    const itemOptions = useMemo(() => {
        return products.map((product: InventoryItem) => ({
            value: product.id,
            label: `${product.code || product.sku || product.id} • ${product.name}`
        }));
    }, [products]);

    const invoiceCandidatesByItem = useMemo<InvoiceCandidate[]>(() => {
        if (!lookupItemId || !returnData.customerId) return [];

        return invoices
            .filter((inv) => inv.customerId === returnData.customerId)
            .map((inv) => {
                const lines = invoiceItemTemplates[inv.id] || [];
                const line = lines.find((entry) => entry.itemId === lookupItemId);
                if (!line) return null;
                const qtySold = Number(line.qtySold || 0);
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
            .filter((candidate): candidate is InvoiceCandidate => candidate !== null && candidate.remainingQty > 0)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [lookupItemId, returnData.customerId, invoices, invoiceItemTemplates, salesReturns, state.returnId]);

    const totals = useMemo(() => {
        const subtotal = returnData.lines.reduce((sum, line) => sum + line.qtyReturn * line.price, 0);
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

    const formatAccountOption = (accountId: string) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId: string) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    const postingPreview = useMemo<PostingLine[]>(() => {
        const lines: PostingLine[] = [
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

    const hydrateLinesFromInvoice = (invoiceId: string): SalesReturnLine[] => {
        const template = invoiceItemTemplates[invoiceId] || [];
        return template.map((line) => normalizeLine({ ...line, qtyReturn: 0 }));
    };

    const handleInvoiceChange = (invoiceId: string) => {
        const invoice = invoices.find((item) => item.id === invoiceId);
        setReturnData((prev) => ({
            ...prev,
            invoiceId,
            customerId: invoice?.customerId || prev.customerId,
            lines: hydrateLinesFromInvoice(invoiceId)
        }));
    };

    const updateLine = (index: number, field: keyof SalesReturnLine, value: string | number) => {
        setReturnData((prev) => {
            const nextLines = [...prev.lines];
            const line = { ...nextLines[index] };

            if (field === 'qtyReturn') {
                const parsed = Number(value || 0);
                const alreadyReturned = getAlreadyReturnedQty(prev.invoiceId, line.itemId, state.returnId);
                const maxReturnableQty = Math.max(0, Number(line.qtySold || 0) - alreadyReturned);
                line.qtyReturn = Math.max(0, Math.min(parsed, maxReturnableQty));
            } else {
                (line as Record<string, unknown>)[field] = value;
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
        const mutationLines: SalesReturnRecord['lines'] = selectedLines.map((line) => ({
            itemId: line.itemId,
            itemName: line.itemName,
            qtySold: line.qtySold,
            qtyReturn: line.qtyReturn,
            unit: line.unit,
            price: line.price,
            lineTotal: line.qtyReturn * line.price
        }));

        const mutationBody: Partial<SalesReturnRecord> = {
            ...(returnNumber && { number: returnNumber }),
            customerId: returnData.customerId,
            invoiceId: returnData.invoiceId,
            returnDate: returnData.returnDate,
            warehouseId: returnData.warehouseId,
            arAccountId: returnData.arAccountId,
            returnAccountId: returnData.returnAccountId,
            taxAccountId: returnData.taxAccountId,
            applyTax: returnData.applyTax,
            taxIncluded: returnData.taxIncluded,
            taxRate: returnData.taxRate,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            totalAmount: totals.total,
            reason: returnData.reason,
            notes: returnData.notes,
            status: 'Pending Credit Note',
            lines: mutationLines
        };

        const returnDraft = {
            ...returnData,
            ...(returnNumber && { returnNumber }),
            lines: selectedLines
        };

        if (state.returnId) {
            updateSalesReturnMutation.mutate({ id: state.returnId, ...mutationBody });
        } else {
            createSalesReturnMutation.mutate(mutationBody);
        }

        navigate('/ar/credits/new', {
            state: {
                mode: 'create',
                source: 'sales-return',
                returnDraft
            }
        });
    };

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';

    const renderAccountField = (label: string, key: SalesReturnAccountKey, options: Account[], disabled = false) => {
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
                        <SearchableSelect options={customerOptions} value={returnData.customerId} onChange={(value: string) => setReturnData((prev) => ({ ...prev, customerId: value, invoiceId: '', lines: [] }))} placeholder="Select Customer..." disabled={isView} />
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
                        <Input className="mb-0" type="date" value={returnData.returnDate} onChange={(event) => setReturnData((prev) => ({ ...prev, returnDate: event.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Warehouse *</label>
                        <select className={fcBase} value={returnData.warehouseId} onChange={(event) => setReturnData((prev) => ({ ...prev, warehouseId: event.target.value }))} disabled={isView}>
                            {warehouses.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>{formatWarehouseLabel(warehouse)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="col-span-3">
                        <label className="form-label">Return #</label>
                        <div className="numbering-row">
                            <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={returnNumberingMode} onChange={(event) => setReturnNumberingMode(event.target.value as ReturnNumberingMode)} disabled={isView}>
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
                                    onChange={(value: string) => setLookupItemId(value)}
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
                                            invoiceCandidatesByItem.map((candidate) => (
                                                <tr key={candidate.invoiceId} className="row-border">
                                                    <td>{candidate.invoiceId}</td>
                                                    <td>{formatDateID(candidate.date)}</td>
                                                    <td className="text-right">{candidate.qtySold}</td>
                                                    <td className="text-right">{candidate.alreadyReturned}</td>
                                                    <td className="text-right text-strong">{candidate.remainingQty}</td>
                                                    <td className="text-right">
                                                        <Button
                                                            text="Use"
                                                            size="small"
                                                            variant="tertiary"
                                                            onClick={() => {
                                                                handleInvoiceChange(candidate.invoiceId);
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
