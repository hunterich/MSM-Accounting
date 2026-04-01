import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { billSchema, zodToFormErrors } from '../../utils/formSchemas';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useBills, useCreateBill, useUpdateBill } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useBillStore } from '../../stores/useBillStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { Account, Bill } from '../../types';
import { resolveAccountDefaults } from '../../../lib/account-defaults';

type BillFormData = {
    vendor: string;
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
};

type BillItem = {
    id: string;
    description: string;
    accountId: string;
    qty: number;
    unit: string;
    price: number;
};

type BillTemplateMap = Record<string, BillTemplateLine[]>;
type FormErrors = Record<string, string | undefined>;

const buildFormData = (bill: Bill | null, defaultApAccountId: string): BillFormData => {
    if (!bill) {
        return {
            vendor: '',
            poNumber: '',
            issueDate: '',
            dueDate: '',
            billNumber: '',
            apAccountId: defaultApAccountId,
            notes: ''
        };
    }

    return {
        vendor: bill.vendor || '',
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
            price: Number(line.price || 0)
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

    const { data: billsData, isLoading: billsLoading } = useBills();
    const bills = billsData?.data || [];

    // Keep Zustand for print templates only
    const billItemTemplates = useBillStore((s) => s.billItemTemplates) as BillTemplateMap;
    const setBillItemTemplates = useBillStore(s => s.setBillItemTemplates);

    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();

    const createBill = useCreateBill();
    const updateBill = useUpdateBill();

    const selectedBill = useMemo<Bill | null>(() => bills.find((bill) => bill.id === billId) || null, [billId, bills]);

    const accountMap = useMemo<Record<string, Account>>(() => {
        return chartOfAccounts.reduce<Record<string, Account>>((map, account) => {
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
    const [taxSettings, setTaxSettings] = useState({
        enabled: globalTaxSettings.enabled,
        inclusive: globalTaxSettings.inclusiveByDefault,
        rate: globalTaxSettings.defaultRate
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
            { id: String(Date.now()), description: '', accountId: defaultAccountId, qty: 1, unit: 'PCS', price: 0 }
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

    const lineTotal = (line: BillItem) => line.qty * line.price;
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

    const postingPreview = useMemo(() => {
        const debitByAccount: Record<string, number> = {};

        items.forEach((line) => {
            const lineAmount = lineTotal(line);
            if (!line.accountId || !lineAmount) return;
            debitByAccount[line.accountId] = (debitByAccount[line.accountId] || 0) + lineAmount;
        });

        const debitLines = Object.entries(debitByAccount).map(([accountId, amount]) => ({
            side: 'DR',
            accountId,
            accountLabel: formatAccountOption(accountId),
            amount
        }));

        if (taxSettings.enabled && taxAmount > 0 && !taxSettings.inclusive) {
            debitLines.push({
                side: 'DR',
                accountId: 'TAX',
                accountLabel: 'VAT Receivable (Input Tax)',
                amount: taxAmount
            });
        }

        const creditLine = {
            side: 'CR',
            accountId: formData.apAccountId,
            accountLabel: formatAccountOption(formData.apAccountId),
            amount: totalAmount
        };

        return [...debitLines, creditLine];
    }, [items, subtotal, formData.apAccountId, accountMap]);

    const legacyLineCount = useMemo(() => {
        return items.filter((line) => {
            const account = accountMap[line.accountId];
            return !account || !account.isActive || !account.isPostable;
        }).length;
    }, [items, accountMap]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isViewMode) {
            navigate('/ap/bills');
            return;
        }

        const schemaResult = billSchema.safeParse({ ...formData, items });
        if (!schemaResult.success) { setErrors(zodToFormErrors(schemaResult.error)); return; }

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0)
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
            vendor: formData.vendor,
            poNumber: formData.poNumber,
            date: formData.issueDate,
            due: formData.dueDate,
            amount: totalAmount,
            status: mode === 'edit' ? selectedBill?.status : 'Unpaid',
            apAccountId: formData.apAccountId,
            taxRate: taxSettings.enabled ? taxSettings.rate : 0,
            notes: formData.notes
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

    const isPending = createBill.isPending || updateBill.isPending;
    const isPageLoading = billsLoading || chartOfAccountsLoading;

    const pageTitle = isViewMode
        ? `View Bill${billId ? ` ${billId}` : ''}`
        : mode === 'edit'
            ? `Edit Bill${billId ? ` ${billId}` : ''}`
            : 'New Bill';

    return (
        <FormPage
            containerClassName="bill-form"
            title={pageTitle}
            backTo="/ap/bills"
            backLabel="Back to Bills"
            isLoading={isPageLoading}
            actions={(
                isViewMode ? (
                    <Button text="Close" variant="primary" onClick={() => navigate('/ap/bills')} />
                ) : (
                    <>
                        <Button text="Cancel" variant="secondary" onClick={() => navigate('/ap/bills')} />
                        <Button
                            text={isPending ? 'Saving...' : (mode === 'edit' ? 'Update Bill' : 'Save Bill')}
                            variant="primary"
                            type="submit"
                            form="bill-form-main"
                            disabled={isPending}
                        />
                    </>
                )
            )}
        >

            <form id="bill-form-main" onSubmit={handleSubmit} className="grid grid-cols-12 gap-4">
                {billId && !selectedBill ? (
                    <div className="col-span-12">
                        <div className="journal-warning-banner">
                            Bill `{billId}` not found in mock data. You are creating a new bill.
                        </div>
                    </div>
                ) : null}

                <div className="col-span-12">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                        <div className="grid grid-cols-12 gap-4">
                            <div className="col-span-6">
                                <Input
                                    label="Vendor *"
                                    name="vendor"
                                    placeholder="Search vendor..."
                                    value={formData.vendor}
                                    onChange={handleChange}
                                    error={errors.vendor}
                                    disabled={isViewMode}
                                />
                            </div>
                            <div className="col-span-2">
                                <Input label="Issue Date" name="issueDate" type="date" value={formData.issueDate} onChange={handleChange} disabled={isViewMode} />
                            </div>
                            <div className="col-span-2">
                                <Input label="Due Date" name="dueDate" type="date" value={formData.dueDate} onChange={handleChange} disabled={isViewMode} />
                            </div>
                            <div className="col-span-2">
                                <Input label="Bill Number" name="billNumber" placeholder="Enter vendor bill #" value={formData.billNumber} onChange={handleChange} disabled={isViewMode} />
                            </div>
                            <div className="col-span-6">
                                <label className="block mb-2 text-sm font-medium text-neutral-700">A/P Control Account *</label>
                                <select
                                    className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.apAccountId ? 'border-danger-500' : ''}`}
                                    name="apAccountId"
                                    value={formData.apAccountId}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                >
                                    <option value="">Select A/P account...</option>
                                    {apControlAccounts.map((account) => (
                                        <option key={account.id} value={account.id}>
                                            {account.code} - {account.name}
                                        </option>
                                    ))}
                                </select>
                                {errors.apAccountId ? <div className="w-full mt-1 text-xs text-danger-500">{errors.apAccountId}</div> : null}
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="Purchase Order (Optional)"
                                    name="poNumber"
                                    placeholder="e.g. PO-2023-001"
                                    value={formData.poNumber}
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
                            <div className="text-base font-semibold text-neutral-800">Bill Items</div>
                            <Button text="Add Line" size="small" variant="secondary" onClick={addLine} disabled={isViewMode} />
                        </div>
                        {legacyLineCount > 0 ? (
                            <div className="journal-warning-banner mb-3">
                                {legacyLineCount} line(s) use inactive/legacy accounts and are read-only.
                            </div>
                        ) : null}
                        {errors.items ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.items}</div> : null}
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr>
                                    <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[25%]">Description</th>
                                    <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[25%]">Expense / Asset Account</th>
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
                                        <td colSpan={7} className="text-center p-6 text-neutral-400">
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
                                            {(() => {
                                                const selectedAccount = accountMap[line.accountId];
                                                if (!selectedAccount) {
                                                    return <div className="journal-account-warning">Unknown account</div>;
                                                }
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
                                                            <option key={account.id} value={account.id}>
                                                                {account.code} - {account.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                );
                                            })()}
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

                <div className="col-span-8">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4">
                        <div className="text-base font-semibold text-neutral-800 mb-3">Posting Preview (A/P)</div>
                        {errors.posting ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.posting}</div> : null}
                        <table className="w-full border-collapse text-sm">
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

                <div className="col-span-4 flex justify-end mt-5">
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
                            <div className="flex justify-between items-center mb-2.5">
                                <span className="text-neutral-600">A/P Account</span>
                                <span className="font-semibold text-sm">{formatAccountOption(formData.apAccountId)}</span>
                            </div>
                            <div className="flex justify-between items-baseline mt-2">
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

export default BillForm;
