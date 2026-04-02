import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';

interface InvoiceAdjustment {
    discount: number;
    penalty:  number;
}

interface ARPaymentData {
    paymentNumber:     string;
    customerId:        string;
    date:              string;
    method:            string;
    depositTo:         string;
    depositAccountId:  string;
    arAccountId:       string;
    discountAccountId: string;
    penaltyAccountId:  string;
    reference:         string;
    selectedInvoices:  string[];
    adjustments:       Record<string, InvoiceAdjustment>;
    totalAmount:       number;
}

type PaymentMode = 'create' | 'view' | 'edit';
type PaymentTab = 'details' | 'invoices';
type PaymentAccountField = 'depositAccountId' | 'arAccountId' | 'discountAccountId' | 'penaltyAccountId';
import StatusTag from '../../components/UI/StatusTag';
import { Check, FileText, User, Calendar, CreditCard, Hash } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useCustomers, useInvoices, useARPayments, useCreateARPayment, useUpdateARPayment } from '../../hooks/useAR';
import { useBankAccounts } from '../../hooks/useBanking';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { resolveAccountDefaults, resolveBankLinkedAssetAccountId } from '../../../lib/account-defaults';

const PaymentForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { data: customersData, isLoading: customersLoading } = useCustomers();
    const customers = (customersData?.data || []) as any[];
    const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();
    const invoices = (invoicesData?.data || []) as any[];
    const { data: paymentsData, isLoading: paymentsLoading } = useARPayments();
    const payments = (paymentsData?.data || []) as any[];
    const { data: bankAccountsData, isLoading: bankAccountsLoading } = useBankAccounts();
    const bankAccounts = (bankAccountsData || []) as any[];
    const { data: coaData, isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const chartOfAccounts = (coaData || []) as any[];
    const accountDefaultsConfig = useSettingsStore((s) => s.accountDefaults);
    const createARPayment = useCreateARPayment();
    const updateARPayment = useUpdateARPayment();
    const [mode, setMode] = useState<PaymentMode>('create');
    const [paymentTab, setPaymentTab] = useState<PaymentTab>('details');

    const [paymentData, setPaymentData] = useState<ARPaymentData>({
        paymentNumber: '',
        customerId: '',
        date: new Date().toISOString().split('T')[0],
        method: 'Bank Transfer',
        depositTo: '',
        depositAccountId: '',
        arAccountId: '',
        discountAccountId: '',
        penaltyAccountId: '',
        reference: '',
        selectedInvoices: [],
        adjustments: {},
        totalAmount: 0
    });

    const [paymentNumberingMode, setPaymentNumberingMode] = useState<'auto' | 'manual'>('auto');
    const [paymentSeqByBank, setPaymentSeqByBank] = useState<Record<string, number>>({
        BCA: 1,
        MANDIRI: 1,
        CASH: 1
    });

    const getBankCode = (bankId: string) => {
        const bank = bankAccounts.find((b) => b.id === bankId);
        return bank?.code || 'BANK';
    };

    const buildPaymentNo = (bankCode: string, dateStr: string, seq: number) => {
        const date = dateStr ? new Date(dateStr) : new Date();
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const seqStr = String(seq).padStart(6, '0');
        return `PAY/${bankCode}/${yyyy}/${mm}/${seqStr}`;
    };

    const paymentNoPreview = buildPaymentNo(
        getBankCode(paymentData.depositTo),
        paymentData.date,
        paymentSeqByBank[getBankCode(paymentData.depositTo)] || 1
    );

    const accountMap = useMemo<Record<string, any>>(() => {
        return chartOfAccounts.reduce((map: Record<string, any>, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const resolvedAccountDefaults = useMemo(
        () => resolveAccountDefaults(chartOfAccounts, accountDefaultsConfig),
        [chartOfAccounts, accountDefaultsConfig]
    );

    const resolvedDepositAccountId = useMemo(
        () => resolveBankLinkedAssetAccountId(bankAccounts, chartOfAccounts, accountDefaultsConfig, paymentData.depositTo),
        [bankAccounts, chartOfAccounts, accountDefaultsConfig, paymentData.depositTo]
    );

    const arAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, [chartOfAccounts]);

    const discountAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Expense');
    }, [chartOfAccounts]);

    const penaltyAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Revenue');
    }, [chartOfAccounts]);

    const depositAccountOptions = arAccountOptions;

    const formatAccountOption = (accountId: string) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId: string) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    // derive totals
    useEffect(() => {
        if (!paymentData.depositTo && bankAccounts[0]?.id) {
            setPaymentData((prev) => ({ ...prev, depositTo: prev.depositTo || bankAccounts[0].id }));
        }
    }, [bankAccounts, paymentData.depositTo]);

    useEffect(() => {
        setPaymentData((prev) => {
            let changed = false;
            const next = { ...prev };

            if (!next.depositAccountId && resolvedDepositAccountId) {
                next.depositAccountId = resolvedDepositAccountId;
                changed = true;
            }
            if (!next.arAccountId && resolvedAccountDefaults.arControl) {
                next.arAccountId = resolvedAccountDefaults.arControl;
                changed = true;
            }
            if (!next.discountAccountId && resolvedAccountDefaults.arDiscount) {
                next.discountAccountId = resolvedAccountDefaults.arDiscount;
                changed = true;
            }
            if (!next.penaltyAccountId && resolvedAccountDefaults.arPenalty) {
                next.penaltyAccountId = resolvedAccountDefaults.arPenalty;
                changed = true;
            }

            return changed ? next : prev;
        });
    }, [resolvedDepositAccountId, resolvedAccountDefaults]);

    useEffect(() => {
        let total = 0;
        paymentData.selectedInvoices.forEach(invId => {
            const invoice = invoices.find(i => i.id === invId);
            if (invoice) {
                const adj = paymentData.adjustments[invId] || { discount: 0, penalty: 0 };
                total += (invoice.amount - (adj.discount || 0) + (adj.penalty || 0));
            }
        });
        setPaymentData(prev => ({ ...prev, totalAmount: total }));
    }, [paymentData.selectedInvoices, paymentData.adjustments, invoices]);

    useEffect(() => {
        const state = location.state || {};
        const isExistingPayment = Boolean(state.paymentId);
        if (isExistingPayment || !resolvedDepositAccountId) return;
        setPaymentData((prev) => (prev.depositAccountId === resolvedDepositAccountId ? prev : { ...prev, depositAccountId: resolvedDepositAccountId }));
    }, [location.state, resolvedDepositAccountId]);

    useEffect(() => {
        const state = location.state || {};
        if (state.mode === 'create' || state.mode === 'view' || state.mode === 'edit') setMode(state.mode);
        if (state.paymentId) {
            const found = payments.find((payment) => payment.id === state.paymentId);
            if (found) {
                const bankMatch = bankAccounts.find((bank) => bank.id === found.bankId) || bankAccounts[0];
                const mappedDeposit =
                    found.depositAccountId ||
                    resolveBankLinkedAssetAccountId(bankAccounts, chartOfAccounts, accountDefaultsConfig, bankMatch?.id) ||
                    resolvedAccountDefaults.bankAsset;
                setPaymentNumberingMode('manual');
                setPaymentData({
                    paymentNumber: found.id,
                    customerId: found.customerId,
                    date: found.date,
                    method: found.method,
                    depositTo: bankMatch?.id || bankAccounts[0]?.id || '',
                    depositAccountId: mappedDeposit,
                    arAccountId: found.arAccountId || resolvedAccountDefaults.arControl,
                    discountAccountId: found.discountAccountId || resolvedAccountDefaults.arDiscount,
                    penaltyAccountId: found.penaltyAccountId || resolvedAccountDefaults.arPenalty,
                    reference: '',
                    selectedInvoices: found.invoiceId ? [found.invoiceId] : [],
                    adjustments: {},
                    totalAmount: Number(found.amount) || 0
                });
            }
        } else {
            setPaymentNumberingMode('auto');
        }
    }, [location.state, payments, bankAccounts, chartOfAccounts, accountDefaultsConfig, resolvedAccountDefaults]);

    const customerOptions = customers.map(c => ({ value: c.id, label: c.name }));
    const bankOptions = bankAccounts.map(b => ({ value: b.id, label: b.name }));
    const methodOptions = [
        { value: 'Bank Transfer', label: 'Bank Transfer' },
        { value: 'Check', label: 'Check' },
        { value: 'Credit Card', label: 'Credit Card' },
        { value: 'Cash', label: 'Cash' }
    ];

    const customerInvoices = useMemo(() => {
        return invoices
            .filter(inv => paymentData.customerId ? inv.customerId === paymentData.customerId : false)
            .filter(inv => String(inv.status).toLowerCase() !== 'paid');
    }, [paymentData.customerId, invoices]);

    const paymentBreakdown = useMemo(() => {
        const selected = paymentData.selectedInvoices.map((invId) => {
            const invoice = invoices.find((item) => item.id === invId);
            if (!invoice) return null;
            const adjustments = paymentData.adjustments[invId] || { discount: 0, penalty: 0 };
            const discount = Number(adjustments.discount || 0);
            const penalty = Number(adjustments.penalty || 0);
            return {
                invoiceId: invId,
                amount: Number(invoice.amount || 0),
                discount,
                penalty
            };
        }).filter((row): row is { invoiceId: string; amount: number; discount: number; penalty: number } => row !== null);

        const invoiceAmount = selected.reduce((sum, row) => sum + row.amount, 0);
        const discountAmount = selected.reduce((sum, row) => sum + row.discount, 0);
        const penaltyAmount = selected.reduce((sum, row) => sum + row.penalty, 0);

        return {
            invoiceAmount,
            discountAmount,
            penaltyAmount,
            netCash: invoiceAmount - discountAmount + penaltyAmount
        };
    }, [paymentData.selectedInvoices, paymentData.adjustments, invoices]);

    const postingPreview = useMemo(() => {
        const lines = [
            {
                side: 'DR',
                accountId: paymentData.depositAccountId,
                amount: paymentBreakdown.netCash
            },
            {
                side: 'CR',
                accountId: paymentData.arAccountId,
                amount: paymentBreakdown.invoiceAmount
            }
        ];

        if (paymentBreakdown.discountAmount > 0) {
            lines.splice(1, 0, {
                side: 'DR',
                accountId: paymentData.discountAccountId,
                amount: paymentBreakdown.discountAmount
            });
        }

        if (paymentBreakdown.penaltyAmount > 0) {
            lines.push({
                side: 'CR',
                accountId: paymentData.penaltyAccountId,
                amount: paymentBreakdown.penaltyAmount
            });
        }

        return lines;
    }, [
        paymentData.depositAccountId,
        paymentData.arAccountId,
        paymentData.discountAccountId,
        paymentData.penaltyAccountId,
        paymentBreakdown.netCash,
        paymentBreakdown.invoiceAmount,
        paymentBreakdown.discountAmount,
        paymentBreakdown.penaltyAmount
    ]);

    const handleCustomerChange = (val: string) => {
        setPaymentData(prev => ({
            ...prev,
            customerId: val,
            selectedInvoices: [],
            adjustments: {},
            totalAmount: 0
        }));
    };

    const toggleInvoiceSelection = (invoiceId: string) => {
        setPaymentData(prev => {
            const isSelected = prev.selectedInvoices.includes(invoiceId);
            const newSelected = isSelected ? prev.selectedInvoices.filter(id => id !== invoiceId) : [...prev.selectedInvoices, invoiceId];
            return { ...prev, selectedInvoices: newSelected };
        });
    };

    const handleAdjustmentChange = (invoiceId: string, field: keyof InvoiceAdjustment, value: string) => {
        const normalized = Math.max(0, Number.parseFloat(value) || 0);
        setPaymentData(prev => ({
            ...prev,
            adjustments: {
                ...prev.adjustments,
                [invoiceId]: {
                    ...prev.adjustments[invoiceId],
                    [field]: normalized
                }
            }
        }));
    };

    const isSaving = createARPayment.isPending || updateARPayment.isPending;
    const isPageLoading =
        customersLoading ||
        invoicesLoading ||
        paymentsLoading ||
        bankAccountsLoading ||
        chartOfAccountsLoading;

    const handleSave = async () => {
        if (!paymentData.customerId) {
            window.alert('Select a customer before saving payment.');
            return;
        }

        if (paymentData.selectedInvoices.length === 0) {
            window.alert('Select at least one invoice before saving payment.');
            return;
        }

        if (Number(paymentData.totalAmount || 0) <= 0) {
            window.alert('Payment total must be greater than zero.');
            return;
        }

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0 && isAccountLegacy(line.accountId))
            .map((line) => formatAccountOption(line.accountId));

        if (invalidPostingAccounts.length > 0) {
            window.alert(
                `Cannot save payment. Posting account is inactive/legacy:\n- ${invalidPostingAccounts.join('\n- ')}`
            );
            return;
        }

        const newPayment = {
            customerId: paymentData.customerId,
            customerName: customers.find((c) => c.id === paymentData.customerId)?.name || '',
            date: paymentData.date,
            method: paymentData.method,
            bankId: paymentData.depositTo,
            depositAccountId: paymentData.depositAccountId,
            arAccountId: paymentData.arAccountId,
            discountAccountId: paymentData.discountAccountId,
            penaltyAccountId: paymentData.penaltyAccountId,
            invoiceId: paymentData.selectedInvoices[0] || '',
            totalAmount: paymentData.totalAmount,
            status: 'Completed',
        };

        try {
            const existingPayment = mode === 'edit' && paymentData.paymentNumber
                ? payments.find((p) => p.id === paymentData.paymentNumber || p.number === paymentData.paymentNumber)
                : null;

            if (existingPayment) {
                await updateARPayment.mutateAsync({ id: existingPayment._id || existingPayment.id, ...newPayment } as any);
            } else {
                await createARPayment.mutateAsync(newPayment as any);
            }
            navigate('/ar/payments');
        } catch (err) {
            window.alert(`Failed to save payment: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';
    const fcSmInline = 'w-full h-8 px-2 rounded border border-neutral-300 bg-neutral-0 text-sm text-right focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed';

    const renderAccountField = (label: string, key: PaymentAccountField, options: any[], disabled = false) => {
        if (isAccountLegacy(paymentData[key])) {
            return (
                <div>
                    <label className="form-label">{label}</label>
                    <div className="journal-account-legacy">
                        <span>{formatAccountOption(paymentData[key])}</span>
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
                    value={paymentData[key]}
                    onChange={(event) => setPaymentData((prev) => ({ ...prev, [key]: event.target.value }))}
                    disabled={mode === 'view' || disabled}
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
            title="Receive Payment"
            backTo="/ar/payments"
            isLoading={isPageLoading}
            actions={(
                <>
                    <Button text="Save Draft" variant="secondary" onClick={() => {}} disabled={isSaving} />
                    <Button text={mode === 'view' ? 'Close' : (isSaving ? 'Saving...' : 'Save Payment')} variant="primary" onClick={mode === 'view' ? () => navigate('/ar/payments') : handleSave} disabled={mode !== 'view' && isSaving} />
                </>
            )}
        >

            <div className="module-status-strip">
                <div className="module-status-meta">
                    <div className="module-status-number">{paymentData.paymentNumber || 'Otomatis'}</div>
                    <StatusTag status={mode === 'view' ? 'Completed' : 'Draft'} label={mode === 'view' ? 'Completed' : 'Draft'} />
                </div>
                <div className="module-status-total">
                    {formatIDR(paymentData.totalAmount)}
                </div>
            </div>

            <div className="invoice-tabs module-tabs module-tabs-spaced">
                <button type="button" className={`invoice-tab ${paymentTab === 'details' ? 'active' : ''}`} onClick={() => setPaymentTab('details')}>
                    <span className="tab-icon"><FileText size={14} /></span>
                    Payment Details
                </button>
                <button type="button" className={`invoice-tab ${paymentTab === 'invoices' ? 'active' : ''}`} onClick={() => setPaymentTab('invoices')}>
                    <span className="tab-icon"><Check size={14} /></span>
                    Invoices
                </button>
            </div>

            {paymentTab === 'details' && (
                <div className="invoice-panel">
                    <div className="grid-12 form-grid-start">
                        <div className="col-span-4">
                            <label className="form-label form-label-icon"><User size={14} /> Customer</label>
                            <SearchableSelect className="mb-0" options={customerOptions} value={paymentData.customerId} onChange={handleCustomerChange} placeholder="Select Customer..." disabled={mode === 'view'} />
                        </div>
                        <div className="col-span-2">
                            <label className="form-label form-label-icon"><Calendar size={14} /> Payment Date</label>
                            <Input className="mb-0" type="date" value={paymentData.date} onChange={(e) => setPaymentData({ ...paymentData, date: e.target.value })} disabled={mode === 'view'} />
                        </div>
                        <div className="col-span-2">
                            <label className="form-label">Method</label>
                            <SearchableSelect
                                className="mb-0"
                                options={methodOptions}
                                value={paymentData.method}
                                onChange={(value: string) => setPaymentData({ ...paymentData, method: value })}
                                placeholder="Select method..."
                                disabled={mode === 'view'}
                            />
                        </div>
                        <div className="col-span-4">
                            <label className="form-label form-label-icon"><Hash size={14} /> Payment #</label>
                            <div className="numbering-row">
                                <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={paymentNumberingMode} onChange={(e) => setPaymentNumberingMode(e.target.value as 'auto' | 'manual')} disabled={mode === 'view'}>
                                    <option value="auto">Auto</option>
                                    <option value="manual">Manual</option>
                                </select>
                                <Input className="mb-0" value={paymentData.paymentNumber} onChange={(e) => setPaymentData({ ...paymentData, paymentNumber: e.target.value })} disabled={mode === 'view' || paymentNumberingMode === 'auto'} placeholder={paymentNumberingMode === 'auto' ? paymentNoPreview : 'Payment #'} />
                            </div>
                            {paymentNumberingMode === 'auto' && (
                                <div className="numbering-preview">
                                    Nomor ditetapkan server saat disimpan
                                </div>
                            )}
                        </div>

                        <div className="col-span-6">
                            <label className="form-label form-label-icon"><CreditCard size={14} /> Deposit To</label>
                            <SearchableSelect
                                className="mb-0"
                                options={bankOptions}
                                value={paymentData.depositTo}
                                onChange={(value: string) => setPaymentData({ ...paymentData, depositTo: value })}
                                placeholder="Select deposit account..."
                                disabled={mode === 'view'}
                            />
                        </div>
                        <div className="col-span-6">
                            <label className="form-label form-label-icon"><FileText size={14} /> Reference / Memo</label>
                            <Input className="mb-0" placeholder="e.g. Check #1234 or Notes" value={paymentData.reference} onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })} disabled={mode === 'view'} />
                        </div>

                        <div className="col-span-3">
                            {renderAccountField('A/R Account (CR)', 'arAccountId', arAccountOptions)}
                        </div>
                        <div className="col-span-3">
                            {renderAccountField('Discount Account (DR)', 'discountAccountId', discountAccountOptions, paymentBreakdown.discountAmount <= 0)}
                        </div>
                        <div className="col-span-3">
                            {renderAccountField('Penalty Account (CR)', 'penaltyAccountId', penaltyAccountOptions, paymentBreakdown.penaltyAmount <= 0)}
                        </div>
                        <div className="col-span-3">
                            {renderAccountField('Deposit Account (DR)', 'depositAccountId', depositAccountOptions)}
                            <div className="numbering-preview">Mapped from Deposit To bank account.</div>
                        </div>

                        <div className="col-span-12">
                            <label className="form-label">Posting Preview</label>
                            <div className="panel-box">
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
            )}

            {paymentTab === 'invoices' && (
                <div className="invoice-panel panel-no-padding">
                    <div className="panel-section-title">Unpaid Invoices</div>
                    {paymentData.customerId ? (
                        customerInvoices.length > 0 ? (
                            <div className="panel-table-wrap">
                                <table className="module-table">
                                    <thead>
                                        <tr>
                                            <th className="text-center"> </th>
                                            <th>Invoice</th>
                                            <th>Date</th>
                                            <th className="text-right">Due Amount</th>
                                            <th className="text-right">Discount</th>
                                            <th className="text-right">Penalty</th>
                                            <th className="text-right">Allocation</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {customerInvoices.map(inv => {
                                            const isSelected = paymentData.selectedInvoices.includes(inv.id);
                                            const adj = paymentData.adjustments[inv.id] || { discount: 0, penalty: 0 };
                                            const toPay = inv.amount - (adj.discount || 0) + (adj.penalty || 0);
                                            return (
                                                <tr key={inv.id} className={`row-border ${isSelected ? 'row-selected' : ''}`}>
                                                    <td className="text-center">
                                                        <input type="checkbox" checked={isSelected} onChange={() => toggleInvoiceSelection(inv.id)} disabled={mode === 'view'} />
                                                    </td>
                                                    <td>{inv.id}</td>
                                                    <td className="text-neutral-600">{formatDateID(inv.date)}</td>
                                                    <td className="text-right">{formatIDR(inv.amount)}</td>
                                                    <td className="compact">
                                                        {isSelected && (
                                                            <input type="number" className={fcSmInline} value={adj.discount || ''} onChange={(e) => handleAdjustmentChange(inv.id, 'discount', e.target.value)} disabled={mode === 'view'} />
                                                        )}
                                                    </td>
                                                    <td className="compact">
                                                        {isSelected && (
                                                            <input type="number" className={fcSmInline} value={adj.penalty || ''} onChange={(e) => handleAdjustmentChange(inv.id, 'penalty', e.target.value)} disabled={mode === 'view'} />
                                                        )}
                                                    </td>
                                                    <td className="text-right text-strong">
                                                        {isSelected ? formatIDR(toPay) : '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="module-empty-state module-empty-state-lg">No unpaid invoices found.</div>
                        )
                    ) : (
                        <div className="module-empty-state module-empty-state-lg">Select a customer above to view invoices.</div>
                    )}
                </div>
            )}
        </FormPage>
    );
};

export default PaymentForm;
