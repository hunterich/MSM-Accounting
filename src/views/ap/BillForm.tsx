import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { billSchema, zodToFormErrors } from '../../utils/formSchemas';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import Tabs from '../../components/UI/Tabs';
import DocumentActionBar from '../../components/UI/DocumentActionBar';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import BillPrintTemplate from '../../components/print/BillPrintTemplate';
import { formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useBills, useCreateBill, useUpdateBill, useDeleteBill, useVendors } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useBillStore } from '../../stores/useBillStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { Account, Bill, BillStatus } from '../../types';
import { resolveAccountDefaults } from '../../../lib/account-defaults';

type BillFormData = {
    vendor: string;
    vendorId: string;
    poNumber: string;
    issueDate: string;
    dueDate: string;
    billNumber: string;
    apAccountId: string;
    notes: string;
};

type BillTemplateLine = {
    description?: string;
    accountId?: string;
    qty?: number | string;
    unit?: string;
    price?: number | string;
    discount?: number | string;
};

type BillItem = {
    id: string;
    description: string;
    accountId: string;
    qty: number;
    unit: string;
    price: number;
    discount: number;
};

type BillTemplateMap = Record<string, BillTemplateLine[]>;
type FormErrors = Record<string, string | undefined>;

const buildFormData = (bill: Bill | null, defaultApAccountId: string): BillFormData => {
    if (!bill) {
        return {
            vendor: '', vendorId: '', poNumber: '', issueDate: '', dueDate: '',
            billNumber: '', apAccountId: defaultApAccountId, notes: ''
        };
    }
    return {
        vendor: bill.vendor || '',
        vendorId: bill.vendorId || '',
        poNumber: bill.poNumber || '',
        issueDate: bill.date || '',
        dueDate: bill.due || '',
        billNumber: bill.id || '',
        apAccountId: bill.apAccountId || defaultApAccountId,
        notes: bill.notes || ''
    };
};

const buildItems = (billId: string, expenseAccounts: Account[], templates: BillTemplateMap): BillItem[] => {
    const defaultAccountId = expenseAccounts[0]?.id || '';
    const source = templates[billId] || [];
    if (source.length > 0) {
        return source.map((line, index) => ({
            id: `${billId || 'new'}-${index}-${Date.now()}`,
            description: line.description || '',
            accountId: line.accountId || defaultAccountId,
            qty: Number(line.qty || 0),
            unit: line.unit || 'PCS',
            price: Number(line.price || 0),
            discount: Number(line.discount || 0),
        }));
    }
    return [];
};

const BillForm = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const billId = searchParams.get('billId') || '';
    const rawMode = searchParams.get('mode') || 'new';
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'new';
    const isViewMode = mode === 'view';

    const [activeTab, setActiveTab] = useState<'items' | 'other'>('items');
    const [printOpen, setPrintOpen] = useState(false);

    const { data: billsData, isLoading: billsLoading } = useBills();
    const bills = billsData?.data || [];
    const { data: vendorsData } = useVendors();
    const vendorOptions = useMemo(
        () => (vendorsData?.data ?? []).map((v) => ({ value: v.id, label: v.name })),
        [vendorsData?.data],
    );

    const billItemTemplates = useBillStore((s) => s.billItemTemplates) as BillTemplateMap;
    const setBillItemTemplates = useBillStore(s => s.setBillItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);

    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();

    const createBill = useCreateBill();
    const updateBill = useUpdateBill();
    const deleteBill = useDeleteBill();

    const selectedBill = useMemo<Bill | null>(() => bills.find((bill) => bill.id === billId) || null, [billId, bills]);

    const accountMap = useMemo<Record<string, Account>>(() => {
        return chartOfAccounts.reduce<Record<string, Account>>((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const expenseTargetAccounts = useMemo(() => {
        return chartOfAccounts.filter(
            (account) => account.isPostable && account.isActive && (account.type === 'Expense' || account.type === 'Asset')
        );
    }, [chartOfAccounts]);

    const apControlAccounts = useMemo(() => {
        return chartOfAccounts.filter(
            (account) => account.isPostable && account.isActive && account.type === 'Liability'
        );
    }, [chartOfAccounts]);

    const globalTaxSettings = useSettingsStore(s => s.taxSettings);
    const accountDefaultsConfig = useSettingsStore((s) => s.accountDefaults);
    const resolvedAccountDefaults = useMemo(
        () => resolveAccountDefaults(chartOfAccounts, accountDefaultsConfig),
        [chartOfAccounts, accountDefaultsConfig]
    );
    const defaultApAccountId = resolvedAccountDefaults.apControl || apControlAccounts[0]?.id || '';
    const [formData, setFormData] = useState<BillFormData>(() => buildFormData(selectedBill, defaultApAccountId));
    const [items, setItems] = useState<BillItem[]>(() => buildItems(billId, expenseTargetAccounts, billItemTemplates));
    const [errors, setErrors] = useState<FormErrors>({});
    // Tax behaviour defaults from app Settings; per-document overrides live on the
    // Other Info tab (Kena Pajak / Total termasuk Pajak).
    const [taxSettings, setTaxSettings] = useState({
        taxable: globalTaxSettings.enabled,
        taxInclusive: globalTaxSettings.inclusiveByDefault,
        rate: globalTaxSettings.defaultRate,
    });

    useEffect(() => {
        setFormData(buildFormData(selectedBill, defaultApAccountId));
        setItems(buildItems(billId, expenseTargetAccounts, billItemTemplates));
        setErrors({});
    }, [selectedBill, billId, expenseTargetAccounts, billItemTemplates, defaultApAccountId]);

    const formatAccountOption = (accountId: string) => {
        const account = accountMap[accountId];
        if (!account) return 'Unknown account';
        return `${account.code} - ${account.name}`;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setErrors((prev) => ({ ...prev, [e.target.name]: undefined }));
    };

    const addLine = () => {
        if (isViewMode) return;
        const defaultAccountId = expenseTargetAccounts[0]?.id || '';
        setItems((prev) => ([
            ...prev,
            { id: String(Date.now()), description: '', accountId: defaultAccountId, qty: 1, unit: 'PCS', price: 0, discount: 0 }
        ]));
    };

    const updateLine = (id: BillItem['id'], field: keyof BillItem, value: string | number) => {
        if (isViewMode) return;
        setItems((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
    };

    const removeLine = (id: BillItem['id']) => {
        if (isViewMode) return;
        setItems((prev) => prev.filter((line) => line.id !== id));
    };

    // lineTotal is net of the per-line discount percent — this is the value
    // persisted and used as the GR/IR inventory cost basis.
    const lineGross = (line: BillItem) => line.qty * line.price;
    const lineTotal = (line: BillItem) => Math.round(lineGross(line) * (1 - (line.discount || 0) / 100) * 100) / 100;
    const subtotalGross = items.reduce((sum, line) => sum + lineGross(line), 0);
    const subtotal = items.reduce((sum, line) => sum + lineTotal(line), 0);
    const discountTotal = Math.round((subtotalGross - subtotal) * 100) / 100;

    const taxAmount = (() => {
        if (!taxSettings.taxable) return 0;
        const rate = taxSettings.rate / 100;
        if (taxSettings.taxInclusive) return subtotal - (subtotal / (1 + rate));
        return subtotal * rate;
    })();
    const totalAmount = taxSettings.taxable && !taxSettings.taxInclusive ? subtotal + taxAmount : subtotal;

    const postingPreview = useMemo(() => {
        const debitByAccount: Record<string, number> = {};
        items.forEach((line) => {
            const amount = Math.round(line.qty * line.price * (1 - (line.discount || 0) / 100) * 100) / 100;
            if (!line.accountId || !amount) return;
            debitByAccount[line.accountId] = (debitByAccount[line.accountId] || 0) + amount;
        });
        const debitLines = Object.entries(debitByAccount).map(([accountId, amount]) => ({
            side: 'DR', accountId, accountLabel: formatAccountOption(accountId), amount
        }));
        if (taxSettings.taxable && taxAmount > 0 && !taxSettings.taxInclusive) {
            const taxAccountId = resolvedAccountDefaults.apTax || '';
            debitLines.push({
                side: 'DR', accountId: taxAccountId,
                accountLabel: taxAccountId ? formatAccountOption(taxAccountId) : 'VAT Receivable (Input Tax)',
                amount: taxAmount
            });
        }
        const creditLine = {
            side: 'CR', accountId: formData.apAccountId,
            accountLabel: formatAccountOption(formData.apAccountId), amount: totalAmount
        };
        return [...debitLines, creditLine];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, subtotal, taxAmount, taxSettings.taxable, taxSettings.taxInclusive, formData.apAccountId, accountMap, resolvedAccountDefaults]);

    const legacyLineCount = useMemo(() => {
        return items.filter((line) => {
            const account = accountMap[line.accountId];
            return !account || !account.isActive || !account.isPostable;
        }).length;
    }, [items, accountMap]);

    const saveBill = async (statusOverride?: BillStatus) => {
        const schemaResult = billSchema.safeParse({ ...formData, items });
        if (!schemaResult.success) { setErrors(zodToFormErrors(schemaResult.error)); return; }
        if (!formData.vendorId) { setErrors({ vendor: 'Pick a vendor from the list.' }); return; }
        if (!formData.issueDate) { setErrors({ issueDate: 'Issue date is required.' }); return; }

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0 && line.accountId)
            .filter((line) => {
                const account = accountMap[line.accountId];
                return !account || !account.isActive || !account.isPostable;
            })
            .map((line) => formatAccountOption(line.accountId));
        if (invalidPostingAccounts.length > 0) {
            setErrors({ posting: `Posting blocked: inactive/legacy account detected (${invalidPostingAccounts.join(', ')}).` });
            return;
        }

        const newBillId = formData.billNumber || `BILL-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
        const finalBillId = isViewMode ? billId : newBillId;

        const finalBill = {
            vendorId: formData.vendorId,
            issueDate: formData.issueDate,
            ...(formData.dueDate && { dueDate: formData.dueDate }),
            status: mode === 'edit' ? selectedBill?.status : (statusOverride ?? 'Unpaid'),
            ...(formData.apAccountId && { apAccountId: formData.apAccountId }),
            taxRate: taxSettings.taxable ? taxSettings.rate : 0,
            taxable: taxSettings.taxable,
            taxInclusive: taxSettings.taxInclusive,
            subtotal,
            taxAmount,
            totalAmount,
            notes: [formData.billNumber && `Vendor bill #: ${formData.billNumber}`, formData.poNumber && `PO: ${formData.poNumber}`, formData.notes]
                .filter(Boolean).join(' | '),
            lines: items
                .filter((line) => line.description.trim())
                .map((line, idx) => ({
                    lineNo: idx + 1,
                    ...(line.accountId && { accountId: line.accountId }),
                    description: line.description.trim(),
                    quantity: Number(line.qty || 0),
                    unit: line.unit || 'PCS',
                    price: Number(line.price || 0),
                    discountPct: Number(line.discount || 0),
                    lineTotal: lineTotal(line),
                })),
        };

        try {
            if (mode === 'edit' && selectedBill) {
                await updateBill.mutateAsync({ id: selectedBill._id || selectedBill.id, ...finalBill });
            } else {
                await createBill.mutateAsync(finalBill);
            }
            setBillItemTemplates(finalBillId, items);
            navigate('/ap/bills');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            window.alert(`Failed to save bill: ${message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isViewMode) { navigate('/ap/bills'); return; }
        await saveBill();
    };

    const handleDelete = async () => {
        if (!selectedBill) return;
        try {
            await deleteBill.mutateAsync(selectedBill._id || selectedBill.id);
            navigate('/ap/bills');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            window.alert(`Failed to delete bill: ${message}`);
        }
    };

    const isPending = createBill.isPending || updateBill.isPending;
    const isPageLoading = billsLoading || chartOfAccountsLoading;
    const entityId = mode === 'new' ? undefined : (selectedBill?._id || selectedBill?.id);

    const pageTitle = isViewMode
        ? `View Bill${billId ? ` ${billId}` : ''}`
        : mode === 'edit' ? `Edit Bill${billId ? ` ${billId}` : ''}` : 'New Bill';

    const viewExtraActions = isViewMode ? (
        <>
            {selectedBill?.status === 'Draft' && (
                <Button text={updateBill.isPending ? 'Approving...' : 'Approve'} variant="primary"
                    disabled={updateBill.isPending}
                    onClick={() => updateBill.mutate({ id: selectedBill._id || selectedBill.id, status: 'Unpaid' })} />
            )}
            {(selectedBill?.status === 'Unpaid' || selectedBill?.status === 'Overdue') && (
                <Button text="Pay" variant="primary"
                    onClick={() => navigate('/ap/payments/new', { state: { mode: 'create', vendorId: selectedBill.vendorId, payBillId: selectedBill.id } })} />
            )}
        </>
    ) : undefined;

    return (
        <FormPage
            containerClassName="bill-form"
            title={pageTitle}
            backTo="/ap/bills"
            backLabel="Back to Bills"
            isLoading={isPageLoading}
            sticky
            actions={(
                <DocumentActionBar
                    entityType="Bill"
                    entityId={entityId}
                    isSaving={isPending}
                    saveLabel={mode === 'edit' ? 'Update Bill' : 'Save & Approve'}
                    onSave={isViewMode ? undefined : () => { void saveBill(); }}
                    onSaveDraft={mode === 'new' ? () => { void saveBill('Draft'); } : undefined}
                    extraActions={viewExtraActions}
                    onPrint={() => setPrintOpen(true)}
                    onDelete={selectedBill?.status === 'Draft' ? () => { void handleDelete(); } : undefined}
                    canDelete={selectedBill?.status === 'Draft'}
                />
            )}
        >
            <Tabs
                className="mb-1"
                active={activeTab}
                onChange={(id) => setActiveTab(id as 'items' | 'other')}
                tabs={[
                    { id: 'items', label: <>Items <span className="text-neutral-400">· {items.length}</span></> },
                    { id: 'other', label: 'Other Info' },
                ]}
            />

            <form id="bill-form-main" onSubmit={handleSubmit} className="grid grid-cols-12 gap-4">
                {billId && !selectedBill ? (
                    <div className="col-span-12">
                        <div className="journal-warning-banner">Bill `{billId}` not found. You are creating a new bill.</div>
                    </div>
                ) : null}

                {activeTab === 'items' && (
                    <>
                        <div className="col-span-12">
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                                <div className="grid grid-cols-12 gap-4">
                                    <div className="col-span-6">
                                        <SearchableSelect
                                            label="Vendor *"
                                            options={vendorOptions}
                                            value={formData.vendorId}
                                            onChange={(vendorId: string) => {
                                                const picked = vendorOptions.find((v) => v.value === vendorId);
                                                setFormData((prev) => ({ ...prev, vendorId, vendor: picked?.label || '' }));
                                                setErrors((prev) => ({ ...prev, vendor: undefined }));
                                            }}
                                            placeholder="Search vendor..."
                                            disabled={isViewMode}
                                        />
                                        {errors.vendor ? <div className="w-full -mt-2 mb-2 text-xs text-danger-500">{errors.vendor}</div> : null}
                                    </div>
                                    <div className="col-span-3">
                                        <Input label="Issue Date" name="issueDate" type="date" value={formData.issueDate} onChange={handleChange} disabled={isViewMode} />
                                    </div>
                                    <div className="col-span-3">
                                        <Input label="Bill Number" name="billNumber" placeholder="Vendor bill #" value={formData.billNumber} onChange={handleChange} disabled={isViewMode} />
                                    </div>
                                    <div className="col-span-6">
                                        <Input label="Purchase Order (Optional)" name="poNumber" placeholder="e.g. PO-2023-001" value={formData.poNumber} onChange={handleChange} disabled={isViewMode} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="col-span-12">
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4">
                                <div className="flex justify-between items-center mb-4 pb-3 border-b border-neutral-100">
                                    <div className="text-base font-semibold text-neutral-800">Bill Items</div>
                                    <Button text="Add Line" size="small" variant="secondary" onClick={addLine} disabled={isViewMode} />
                                </div>
                                {legacyLineCount > 0 ? (
                                    <div className="journal-warning-banner mb-3">{legacyLineCount} line(s) use inactive/legacy accounts and are read-only.</div>
                                ) : null}
                                {errors.items ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.items}</div> : null}
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[24%]">Description</th>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[22%]">Expense / Asset Account</th>
                                            <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Qty</th>
                                            <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Unit</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[13%]">Price</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Disc %</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[13%]">Line Total</th>
                                            <th className="p-2 border-b border-neutral-200 w-[4%]"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.length === 0 ? (
                                            <tr><td colSpan={8} className="text-center p-6 text-neutral-400">No items added</td></tr>
                                        ) : items.map((line) => (
                                            <tr key={line.id} className="border-b border-neutral-100">
                                                <td className="p-2">
                                                    <Input value={line.description} onChange={(e) => updateLine(line.id, 'description', e.target.value)} placeholder="Description" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    {(() => {
                                                        const selectedAccount = accountMap[line.accountId];
                                                        if (!selectedAccount) return <div className="journal-account-warning">Unknown account</div>;
                                                        if (!selectedAccount.isActive || !selectedAccount.isPostable) {
                                                            return (
                                                                <div className="journal-account-legacy">
                                                                    <span>{formatAccountOption(line.accountId)}</span>
                                                                    <span className="coa-state-badge coa-state-archived">Legacy / Inactive</span>
                                                                </div>
                                                            );
                                                        }
                                                        return (
                                                            <select
                                                                className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                                                value={line.accountId}
                                                                onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                                                                disabled={isViewMode}
                                                            >
                                                                {expenseTargetAccounts.map((account) => (
                                                                    <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                                                                ))}
                                                            </select>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="p-2">
                                                    <Input type="number" value={line.qty} onChange={(e) => updateLine(line.id, 'qty', Number(e.target.value))} inputClassName="min-h-8 px-2 text-sm text-center" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <Input value={line.unit} onChange={(e) => updateLine(line.id, 'unit', e.target.value)} inputClassName="min-h-8 px-2 text-sm text-center" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <Input type="number" value={line.price} onChange={(e) => updateLine(line.id, 'price', Number(e.target.value))} inputClassName="min-h-8 px-2 text-sm text-right" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <Input type="number" value={line.discount} onChange={(e) => updateLine(line.id, 'discount', Number(e.target.value))} inputClassName="min-h-8 px-2 text-sm text-right" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2 text-right font-semibold text-neutral-800">{formatIDR(lineTotal(line))}</td>
                                                <td className="p-2 text-center">
                                                    <button onClick={() => removeLine(line.id)} className="text-danger-500 hover:text-danger-700 text-lg font-bold bg-transparent border-0 cursor-pointer" title="Remove" disabled={isViewMode}>×</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="col-span-12 flex justify-end mt-1">
                            <div className="w-[320px]">
                                <div className="p-5 bg-neutral-50 border border-neutral-200 rounded-lg">
                                    <div className="flex justify-between items-center mb-2.5">
                                        <span className="text-neutral-600">Subtotal</span>
                                        <span className="font-semibold">{formatIDR(subtotal)}</span>
                                    </div>
                                    {discountTotal > 0 && (
                                        <div className="flex justify-between items-center mb-2.5">
                                            <span className="text-neutral-600">Discount</span>
                                            <span className="font-semibold text-neutral-600">-{formatIDR(discountTotal)}</span>
                                        </div>
                                    )}
                                    {taxSettings.taxable && (
                                        <div className="flex justify-between items-center mb-2.5">
                                            <span className="text-neutral-600">Tax ({taxSettings.rate}%){taxSettings.taxInclusive ? ' incl.' : ''}</span>
                                            <span className="font-semibold text-neutral-600">{formatIDR(taxAmount)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-baseline mt-2 pt-2 border-t border-neutral-200">
                                        <span className="text-[1.1rem] font-bold text-neutral-800">Total</span>
                                        <span className="text-[1.4rem] font-extrabold text-primary-700">{formatIDR(totalAmount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {activeTab === 'other' && (
                    <div className="col-span-12 mt-4">
                        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                            <div className="grid grid-cols-12 gap-6">
                                <div className="col-span-6 flex flex-col gap-4">
                                    <Input label="Due Date" name="dueDate" type="date" value={formData.dueDate} onChange={handleChange} disabled={isViewMode} />
                                    <Input label="Internal Notes" name="notes" placeholder="Notes" value={formData.notes} onChange={handleChange} disabled={isViewMode} />
                                    <div>
                                        <div className="text-xs text-neutral-500 mb-1">A/P Control Account</div>
                                        <div className="text-sm text-neutral-800">{formatAccountOption(formData.apAccountId)} <span className="text-neutral-400">(auto)</span></div>
                                        <div className="text-xs text-neutral-400 mt-0.5">Auto-selected from Settings — rarely changed.</div>
                                    </div>
                                </div>
                                <div className="col-span-6">
                                    <div className="text-sm font-semibold text-neutral-800 mb-2">Info Pajak</div>
                                    <label className="flex items-start gap-2.5 text-sm text-neutral-700 cursor-pointer py-2 border-b border-neutral-100">
                                        <input type="checkbox" checked={taxSettings.taxable}
                                            onChange={(e) => setTaxSettings(p => ({ ...p, taxable: e.target.checked }))}
                                            disabled={isViewMode} className="mt-0.5 w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
                                        <span>Kena Pajak <span className="text-neutral-400 text-xs">(taxable)</span><br /><span className="text-xs text-neutral-400">Default from Settings (PPN {taxSettings.rate}%). Uncheck for a non-PKP vendor.</span></span>
                                    </label>
                                    <label className="flex items-start gap-2.5 text-sm text-neutral-700 cursor-pointer py-2 border-b border-neutral-100">
                                        <input type="checkbox" checked={taxSettings.taxInclusive}
                                            onChange={(e) => setTaxSettings(p => ({ ...p, taxInclusive: e.target.checked }))}
                                            disabled={isViewMode} className="mt-0.5 w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
                                        <span>Total termasuk Pajak <span className="text-neutral-400 text-xs">(tax inclusive)</span><br /><span className="text-xs text-neutral-400">Check when the price already includes PPN.</span></span>
                                    </label>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-neutral-100">
                                <div className="text-sm font-semibold text-neutral-800 mb-3">Posting Preview (A/P)</div>
                                {errors.posting ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.posting}</div> : null}
                                <table className="w-full border-collapse text-sm max-w-[560px]">
                                    <thead>
                                        <tr>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600">Side</th>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600">Account</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {postingPreview.map((line, index) => (
                                            <tr key={`${line.side}-${line.accountId}-${index}`}>
                                                <td className="p-2 border-b border-neutral-100">{line.side}</td>
                                                <td className="p-2 border-b border-neutral-100">{line.accountLabel}</td>
                                                <td className="text-right p-2 border-b border-neutral-100">{formatIDR(line.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </form>

            <PrintPreviewModal
                isOpen={printOpen}
                onClose={() => setPrintOpen(false)}
                title="Bill Print Preview"
                documentTitle={`Bill_${formData.billNumber || billId || ''}`}
            >
                <BillPrintTemplate
                    bill={{
                        id: formData.billNumber || billId,
                        vendor: formData.vendor,
                        date: formData.issueDate,
                        due: formData.dueDate,
                        notes: formData.notes,
                        subtotal, taxAmount, totalAmount,
                    } as unknown as Record<string, unknown>}
                    lineItems={items.map((l) => ({
                        description: l.description, quantity: l.qty, unit: l.unit, price: l.price, lineTotal: lineTotal(l),
                    })) as unknown as Record<string, unknown>[]}
                    company={company as unknown as Record<string, unknown>}
                />
            </PrintPreviewModal>
        </FormPage>
    );
};

export default BillForm;
