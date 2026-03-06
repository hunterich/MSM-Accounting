import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import StatusTag from '../../components/UI/StatusTag';
import { Calendar, CreditCard, FileText, Hash } from 'lucide-react';
import { bankAccounts, bills, chartOfAccounts, vendors } from '../../data/mockData';
import { useAPPaymentStore } from '../../stores/useAPPaymentStore';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';

const BANK_TO_GL_ACCOUNT_MAP = {
    'BANK-001': 'COA-1120',
    'BANK-002': 'COA-1130',
    'BANK-003': 'COA-1110'
};

const buildPaymentNo = (bankCode, dateStr, seq) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const seqStr = String(seq).padStart(6, '0');
    return `APP/${bankCode}/${yyyy}/${mm}/${seqStr}`;
};

const PaymentForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { apPayments, addPayment, updatePayment } = useAPPaymentStore();
    const [mode, setMode] = useState('create');

    const [paymentData, setPaymentData] = useState({
        paymentNumber: '',
        vendorId: '',
        date: new Date().toISOString().split('T')[0],
        method: 'Bank Transfer',
        payFrom: 'BANK-001',
        cashAccountId: 'COA-1120',
        apAccountId: 'COA-2100',
        discountAccountId: 'COA-4200',
        penaltyAccountId: 'COA-5300',
        reference: '',
        selectedBills: [],
        adjustments: {},
        totalAmount: 0
    });

    const [paymentTab, setPaymentTab] = useState('details');
    const [paymentNumberingMode, setPaymentNumberingMode] = useState('auto');
    const [paymentSeqByBank, setPaymentSeqByBank] = useState({ BCA: 1, MANDIRI: 1, CASH: 1 });

    const accountMap = useMemo(() => {
        return chartOfAccounts.reduce((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, []);

    const apAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Liability');
    }, []);

    const discountAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Revenue');
    }, []);

    const penaltyAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Expense');
    }, []);

    const cashAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, []);

    const getBankCode = (bankId) => {
        const bank = bankAccounts.find((item) => item.id === bankId);
        return bank?.code || 'BANK';
    };

    const paymentNoPreview = buildPaymentNo(
        getBankCode(paymentData.payFrom),
        paymentData.date,
        paymentSeqByBank[getBankCode(paymentData.payFrom)] || 1
    );

    const formatAccountOption = (accountId) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    useEffect(() => {
        const mapped = BANK_TO_GL_ACCOUNT_MAP[paymentData.payFrom];
        if (!mapped) return;
        setPaymentData((prev) => (prev.cashAccountId === mapped ? prev : { ...prev, cashAccountId: mapped }));
    }, [paymentData.payFrom]);

    useEffect(() => {
        const state = location.state || {};
        if (state.mode) setMode(state.mode);

        if (state.paymentId) {
            const found = apPayments.find((p) => p.id === state.paymentId);
            if (!found) return;
            setPaymentNumberingMode('manual');
            setPaymentData({
                paymentNumber: found.id,
                vendorId: found.vendorId,
                date: found.date,
                method: found.method,
                payFrom: found.bankId,
                cashAccountId: found.depositAccountId || 'COA-1120',
                apAccountId: found.apAccountId || 'COA-2100',
                discountAccountId: found.discountAccountId || 'COA-4200',
                penaltyAccountId: found.penaltyAccountId || 'COA-5300',
                reference: '',
                selectedBills: found.billId ? [found.billId] : [],
                adjustments: {},
                totalAmount: found.amount
            });
            return;
        }

        setPaymentNumberingMode('auto');
    }, [location.state]);

    useEffect(() => {
        let total = 0;
        paymentData.selectedBills.forEach((billId) => {
            const bill = bills.find((item) => item.id === billId);
            if (!bill) return;
            const adjustment = paymentData.adjustments[billId] || { discount: 0, penalty: 0 };
            total += Number(bill.amount || 0) - Number(adjustment.discount || 0) + Number(adjustment.penalty || 0);
        });
        setPaymentData((prev) => ({ ...prev, totalAmount: total }));
    }, [paymentData.selectedBills, paymentData.adjustments]);

    const vendorOptions = vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }));
    const bankOptions = bankAccounts.map((bank) => ({ value: bank.id, label: bank.name }));
    const methodOptions = [
        { value: 'Bank Transfer', label: 'Bank Transfer' },
        { value: 'Check', label: 'Check' },
        { value: 'Cash', label: 'Cash' }
    ];

    const vendorBills = useMemo(() => {
        return bills.filter((bill) => {
            if (!paymentData.vendorId || bill.vendorId !== paymentData.vendorId) return false;
            return bill.status !== 'Paid';
        });
    }, [paymentData.vendorId]);

    const paymentBreakdown = useMemo(() => {
        const selected = paymentData.selectedBills
            .map((billId) => {
                const bill = bills.find((item) => item.id === billId);
                if (!bill) return null;
                const adjustment = paymentData.adjustments[billId] || { discount: 0, penalty: 0 };
                return {
                    billId,
                    amount: Number(bill.amount || 0),
                    discount: Number(adjustment.discount || 0),
                    penalty: Number(adjustment.penalty || 0)
                };
            })
            .filter(Boolean);

        const billAmount = selected.reduce((sum, row) => sum + row.amount, 0);
        const discountAmount = selected.reduce((sum, row) => sum + row.discount, 0);
        const penaltyAmount = selected.reduce((sum, row) => sum + row.penalty, 0);
        const cashAmount = billAmount - discountAmount + penaltyAmount;

        return { billAmount, discountAmount, penaltyAmount, cashAmount };
    }, [paymentData.selectedBills, paymentData.adjustments]);

    const postingPreview = useMemo(() => {
        const lines = [
            { side: 'DR', accountId: paymentData.apAccountId, amount: paymentBreakdown.billAmount },
            { side: 'CR', accountId: paymentData.cashAccountId, amount: paymentBreakdown.cashAmount }
        ];

        if (paymentBreakdown.discountAmount > 0) {
            lines.push({ side: 'CR', accountId: paymentData.discountAccountId, amount: paymentBreakdown.discountAmount });
        }
        if (paymentBreakdown.penaltyAmount > 0) {
            lines.push({ side: 'DR', accountId: paymentData.penaltyAccountId, amount: paymentBreakdown.penaltyAmount });
        }

        return lines;
    }, [
        paymentData.apAccountId,
        paymentData.cashAccountId,
        paymentData.discountAccountId,
        paymentData.penaltyAccountId,
        paymentBreakdown.billAmount,
        paymentBreakdown.cashAmount,
        paymentBreakdown.discountAmount,
        paymentBreakdown.penaltyAmount
    ]);

    const handleVendorChange = (vendorId) => {
        const vendor = vendors.find((item) => item.id === vendorId);
        setPaymentData((prev) => ({
            ...prev,
            vendorId,
            apAccountId: vendor?.defaultApAccountId || prev.apAccountId,
            selectedBills: [],
            adjustments: {},
            totalAmount: 0
        }));
    };

    const toggleBillSelection = (billId) => {
        setPaymentData((prev) => {
            const selected = prev.selectedBills.includes(billId)
                ? prev.selectedBills.filter((id) => id !== billId)
                : [...prev.selectedBills, billId];
            return { ...prev, selectedBills: selected };
        });
    };

    const handleAdjustmentChange = (billId, field, value) => {
        const normalized = Math.max(0, Number.parseFloat(value) || 0);
        setPaymentData((prev) => ({
            ...prev,
            adjustments: {
                ...prev.adjustments,
                [billId]: {
                    ...prev.adjustments[billId],
                    [field]: normalized
                }
            }
        }));
    };

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';
    const fcSmInline = 'w-full h-8 px-2 rounded border border-neutral-300 bg-neutral-0 text-sm text-right focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed';

    const renderAccountField = (label, key, options, disabled = false) => {
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

    const handleSave = () => {
        if (!paymentData.vendorId) {
            window.alert('Select a vendor before saving payment.');
            return;
        }

        if (paymentData.selectedBills.length === 0) {
            window.alert('Select at least one bill before saving payment.');
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
            window.alert(`Cannot save AP payment. Posting account is inactive/legacy:\n- ${invalidPostingAccounts.join('\n- ')}`);
            return;
        }

        let paymentNo = paymentData.paymentNumber;
        if (paymentNumberingMode === 'auto') {
            const bankCode = getBankCode(paymentData.payFrom);
            const seq = paymentSeqByBank[bankCode] || 1;
            paymentNo = buildPaymentNo(bankCode, paymentData.date, seq);
            setPaymentSeqByBank((prev) => ({ ...prev, [bankCode]: seq + 1 }));
        }

        setPaymentData((prev) => ({ ...prev, paymentNumber: paymentNo }));

        const newPayment = {
            id: paymentNo,
            vendorId: paymentData.vendorId,
            vendorName: vendors.find((v) => v.id === paymentData.vendorId)?.name || '',
            date: paymentData.date,
            method: paymentData.method,
            bankId: paymentData.payFrom,
            depositAccountId: paymentData.cashAccountId,
            apAccountId: paymentData.apAccountId,
            discountAccountId: paymentData.discountAccountId,
            penaltyAccountId: paymentData.penaltyAccountId,
            billId: paymentData.selectedBills[0] || '',
            amount: paymentData.totalAmount,
            status: 'Completed',
        };

        if (mode === 'edit' && paymentData.paymentNumber) {
            updatePayment(paymentData.paymentNumber, newPayment);
        } else {
            addPayment(newPayment);
        }
        navigate('/ap/payments');
    };

    return (
        <FormPage
            containerClassName="ap-module"
            title="Bill Payment"
            backTo="/ap/payments"
            actions={
                <>
                    <Button text="Save Draft" variant="secondary" />
                    <Button text={mode === 'view' ? 'Close' : 'Save Payment'} variant="primary" onClick={mode === 'view' ? () => navigate('/ap/payments') : handleSave} />
                </>
            }
        >
            <div className="module-status-strip">
                <div className="module-status-meta">
                    <div className="module-status-number">{paymentData.paymentNumber || 'APP-XXXX'}</div>
                    <StatusTag status={mode === 'view' ? 'Completed' : 'Draft'} label={mode === 'view' ? 'Completed' : 'Draft'} />
                </div>
                <div className="module-status-total">{formatIDR(paymentData.totalAmount)}</div>
            </div>

            <div className="invoice-tabs module-tabs module-tabs-spaced">
                <button className={`invoice-tab ${paymentTab === 'details' ? 'active' : ''}`} onClick={() => setPaymentTab('details')}>Payment Details</button>
                <button className={`invoice-tab ${paymentTab === 'bills' ? 'active' : ''}`} onClick={() => setPaymentTab('bills')}>Bills</button>
            </div>

            {paymentTab === 'details' ? (
                <div className="invoice-panel">
                    <div className="grid-12 form-grid-start">
                        <div className="col-span-4">
                            <label className="form-label">Vendor</label>
                            <SearchableSelect className="mb-0" options={vendorOptions} value={paymentData.vendorId} onChange={handleVendorChange} placeholder="Select vendor..." disabled={mode === 'view'} />
                        </div>
                        <div className="col-span-2">
                            <label className="form-label form-label-icon"><Calendar size={14} /> Payment Date</label>
                            <Input className="mb-0" type="date" value={paymentData.date} onChange={(event) => setPaymentData((prev) => ({ ...prev, date: event.target.value }))} disabled={mode === 'view'} />
                        </div>
                        <div className="col-span-2">
                            <label className="form-label">Method</label>
                            <SearchableSelect className="mb-0" options={methodOptions} value={paymentData.method} onChange={(value) => setPaymentData((prev) => ({ ...prev, method: value }))} placeholder="Select method..." disabled={mode === 'view'} />
                        </div>
                        <div className="col-span-4">
                            <label className="form-label form-label-icon"><Hash size={14} /> Payment #</label>
                            <div className="numbering-row">
                                <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={paymentNumberingMode} onChange={(event) => setPaymentNumberingMode(event.target.value)} disabled={mode === 'view'}>
                                    <option value="auto">Auto</option>
                                    <option value="manual">Manual</option>
                                </select>
                                <Input className="mb-0" value={paymentData.paymentNumber} onChange={(event) => setPaymentData((prev) => ({ ...prev, paymentNumber: event.target.value }))} disabled={mode === 'view' || paymentNumberingMode === 'auto'} placeholder={paymentNoPreview} />
                            </div>
                            {paymentNumberingMode === 'auto' ? (
                                <div className="numbering-preview">Assigned on save • Preview: {paymentNoPreview}</div>
                            ) : null}
                        </div>

                        <div className="col-span-6">
                            <label className="form-label form-label-icon"><CreditCard size={14} /> Pay From</label>
                            <SearchableSelect className="mb-0" options={bankOptions} value={paymentData.payFrom} onChange={(value) => setPaymentData((prev) => ({ ...prev, payFrom: value }))} placeholder="Select bank account..." disabled={mode === 'view'} />
                        </div>
                        <div className="col-span-6">
                            <label className="form-label form-label-icon"><FileText size={14} /> Reference / Memo</label>
                            <Input className="mb-0" value={paymentData.reference} onChange={(event) => setPaymentData((prev) => ({ ...prev, reference: event.target.value }))} placeholder="e.g. transfer reference" disabled={mode === 'view'} />
                        </div>

                        <div className="col-span-3">{renderAccountField('A/P Account (DR)', 'apAccountId', apAccountOptions)}</div>
                        <div className="col-span-3">{renderAccountField('Cash/Bank Account (CR)', 'cashAccountId', cashAccountOptions)}</div>
                        <div className="col-span-3">{renderAccountField('Discount Account (CR)', 'discountAccountId', discountAccountOptions, paymentBreakdown.discountAmount <= 0)}</div>
                        <div className="col-span-3">{renderAccountField('Penalty Account (DR)', 'penaltyAccountId', penaltyAccountOptions, paymentBreakdown.penaltyAmount <= 0)}</div>

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
            ) : (
                <div className="invoice-panel panel-no-padding">
                    <div className="panel-section-title">Open Bills</div>
                    {paymentData.vendorId ? (
                        vendorBills.length > 0 ? (
                            <div className="panel-table-wrap">
                                <table className="module-table">
                                    <thead>
                                        <tr>
                                            <th className="text-center"> </th>
                                            <th>Bill</th>
                                            <th>Date</th>
                                            <th className="text-right">Amount</th>
                                            <th className="text-right">Discount</th>
                                            <th className="text-right">Penalty</th>
                                            <th className="text-right">Allocation</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {vendorBills.map((bill) => {
                                            const selected = paymentData.selectedBills.includes(bill.id);
                                            const adjustment = paymentData.adjustments[bill.id] || { discount: 0, penalty: 0 };
                                            const allocation = Number(bill.amount || 0) - Number(adjustment.discount || 0) + Number(adjustment.penalty || 0);
                                            return (
                                                <tr key={bill.id} className={`row-border ${selected ? 'row-selected' : ''}`}>
                                                    <td className="text-center"><input type="checkbox" checked={selected} onChange={() => toggleBillSelection(bill.id)} disabled={mode === 'view'} /></td>
                                                    <td>{bill.id}</td>
                                                    <td className="text-neutral-600">{formatDateID(bill.date)}</td>
                                                    <td className="text-right">{formatIDR(bill.amount)}</td>
                                                    <td className="compact">{selected ? <input type="number" className={fcSmInline} value={adjustment.discount || ''} onChange={(event) => handleAdjustmentChange(bill.id, 'discount', event.target.value)} disabled={mode === 'view'} /> : null}</td>
                                                    <td className="compact">{selected ? <input type="number" className={fcSmInline} value={adjustment.penalty || ''} onChange={(event) => handleAdjustmentChange(bill.id, 'penalty', event.target.value)} disabled={mode === 'view'} /> : null}</td>
                                                    <td className="text-right text-strong">{selected ? formatIDR(allocation) : '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="module-empty-state module-empty-state-lg">No open bills found for selected vendor.</div>
                        )
                    ) : (
                        <div className="module-empty-state module-empty-state-lg">Select a vendor first.</div>
                    )}
                </div>
            )}
        </FormPage>
    );
};

export default PaymentForm;
