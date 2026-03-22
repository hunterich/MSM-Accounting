import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import { useBankAccounts } from '../../hooks/useBanking';
import { useBills } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useDebitNotes, usePurchaseReturns, useCreateDebitNote, useUpdateDebitNote } from '../../hooks/useReturns';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';

const BANK_TO_GL_ACCOUNT_MAP = {
    'BANK-001': 'COA-1120',
    'BANK-002': 'COA-1130',
    'BANK-003': 'COA-1110'
};

const buildDebitNo = (dateStr, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `DBN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const toReturnTotals = (purchaseReturn) => {
    if (!purchaseReturn) return { subtotal: 0, taxAmount: 0, total: 0 };
    const subtotal = (purchaseReturn.lines || []).reduce((sum, line) => {
        return sum + Number(line.qtyReturn || 0) * Number(line.price || 0);
    }, 0);
    if (!purchaseReturn.applyTax) return { subtotal, taxAmount: 0, total: subtotal };
    const rate = Number(purchaseReturn.taxRate || 0) / 100;
    if (purchaseReturn.taxIncluded) {
        const base = subtotal / (1 + rate);
        return { subtotal, taxAmount: subtotal - base, total: subtotal };
    }
    const taxAmount = subtotal * rate;
    return { subtotal, taxAmount, total: subtotal + taxAmount };
};

const DebitNoteForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { data: bankAccounts = [] } = useBankAccounts();
    const { data: billsData } = useBills();
    const bills = billsData?.data ?? [];
    const { data: chartOfAccounts = [] } = useChartOfAccounts();
    const { data: dnData } = useDebitNotes();
    const debitNotes = dnData?.data ?? [];
    const { data: prData } = usePurchaseReturns();
    const purchaseReturns = prData?.data ?? [];
    const createDebitNote = useCreateDebitNote();
    const updateDebitNoteMutation = useUpdateDebitNote();
    const state = location.state || {};
    const mode = state.mode || 'create';
    const isView = mode === 'view';

    const [numberingMode, setNumberingMode] = useState('auto');
    const [formData, setFormData] = useState({
        debitNumber: '',
        debitDate: new Date().toISOString().split('T')[0],
        linkedReturnId: '',
        vendorId: '',
        vendorName: '',
        sourceBillId: '',
        settlementType: 'Apply to Bill',
        settlementRef: '',
        refundBankId: bankAccounts[0]?.id || '',
        refundMethod: 'Bank Transfer',
        settlementAccountId: 'COA-1120',
        apAccountId: 'COA-2100',
        returnAccountId: 'COA-5300',
        taxAccountId: 'COA-1210',
        note: '',
        amount: 0,
        lines: [],
        applyTax: true,
        taxIncluded: false,
        taxRate: 11
    });

    const accountMap = useMemo(() => {
        return chartOfAccounts.reduce((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, []);

    const apAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Liability');
    }, []);

    const returnAccountOptions = useMemo(() => {
        return chartOfAccounts.filter(
            (account) =>
                account.isActive && account.isPostable && (account.type === 'Expense' || account.type === 'Asset')
        );
    }, []);

    const taxAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, []);

    const settlementAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, []);

    useEffect(() => {
        if (state.returnDraft) {
            const draft = state.returnDraft;
            const sourceBill = bills.find((item) => item.id === draft.billId);
            setNumberingMode('auto');
            setFormData((prev) => ({
                ...prev,
                debitDate: draft.returnDate || prev.debitDate,
                linkedReturnId: draft.returnNumber,
                vendorId: draft.vendorId,
                vendorName: sourceBill?.vendor || '',
                sourceBillId: draft.billId,
                settlementRef: '',
                apAccountId: draft.apAccountId || prev.apAccountId,
                returnAccountId: draft.returnAccountId || prev.returnAccountId,
                taxAccountId: draft.taxAccountId || prev.taxAccountId,
                amount: toReturnTotals(draft).total,
                lines: draft.lines || [],
                applyTax: draft.applyTax,
                taxIncluded: draft.taxIncluded,
                taxRate: draft.taxRate
            }));
            return;
        }

        if (state.debitId) {
            const found = debitNotes.find((item) => item.id === state.debitId);
            if (!found) return;
            const linkedReturn = purchaseReturns.find((item) => item.id === found.returnId);
            setNumberingMode('manual');
            setFormData((prev) => ({
                ...prev,
                debitNumber: found.id,
                debitDate: found.date,
                linkedReturnId: found.returnId,
                vendorId: found.vendorId,
                vendorName: found.vendorName,
                sourceBillId: found.sourceBillId,
                settlementType: found.settlementType,
                settlementRef: found.settlementRef || '',
                settlementAccountId: found.settlementAccountId || prev.settlementAccountId,
                apAccountId: found.apAccountId || prev.apAccountId,
                returnAccountId: found.returnAccountId || prev.returnAccountId,
                taxAccountId: found.taxAccountId || prev.taxAccountId,
                amount: found.amount,
                lines: linkedReturn?.lines || [],
                applyTax: found.applyTax,
                taxIncluded: linkedReturn?.taxIncluded ?? false,
                taxRate: linkedReturn?.taxRate ?? 11
            }));
        }
    }, [state.returnDraft, state.debitId]);

    useEffect(() => {
        if (formData.settlementType !== 'Refund from Vendor') return;
        const mappedAccountId = BANK_TO_GL_ACCOUNT_MAP[formData.refundBankId];
        if (!mappedAccountId) return;
        setFormData((prev) => (prev.settlementAccountId === mappedAccountId ? prev : { ...prev, settlementAccountId: mappedAccountId }));
    }, [formData.refundBankId, formData.settlementType]);

    const debitNoPreview = useMemo(() => buildDebitNo(formData.debitDate, debitNotes.length + 1), [formData.debitDate]);

    const openBillsForVendor = useMemo(() => {
        if (!formData.vendorId) return [];
        return bills
            .filter((bill) => bill.vendorId === formData.vendorId)
            .filter((bill) => bill.status !== 'Paid')
            .map((bill) => ({ value: bill.id, label: `${bill.id} • ${formatDateID(bill.date)} • ${formatIDR(bill.amount)}` }));
    }, [formData.vendorId]);

    const totals = useMemo(() => {
        const subtotal = formData.lines.reduce((sum, line) => sum + Number(line.qtyReturn || 0) * Number(line.price || 0), 0);
        if (!formData.applyTax) return { subtotal, taxAmount: 0, total: subtotal };
        const rate = Number(formData.taxRate || 0) / 100;
        if (formData.taxIncluded) {
            const base = subtotal / (1 + rate);
            return { subtotal, taxAmount: subtotal - base, total: subtotal };
        }
        const taxAmount = subtotal * rate;
        return { subtotal, taxAmount, total: subtotal + taxAmount };
    }, [formData.lines, formData.applyTax, formData.taxIncluded, formData.taxRate]);

    const formatAccountOption = (accountId) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    const postingPreview = useMemo(() => {
        const debitAccountId = formData.settlementType === 'Apply to Bill' ? formData.apAccountId : formData.settlementAccountId;
        const lines = [{ side: 'DR', accountId: debitAccountId, amount: totals.total }];

        lines.push({ side: 'CR', accountId: formData.returnAccountId, amount: totals.subtotal });
        if (formData.applyTax && totals.taxAmount > 0) {
            lines.push({ side: 'CR', accountId: formData.taxAccountId, amount: totals.taxAmount });
        }

        return lines;
    }, [formData.settlementType, formData.apAccountId, formData.settlementAccountId, formData.returnAccountId, formData.taxAccountId, formData.applyTax, totals.subtotal, totals.taxAmount, totals.total]);

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';

    const renderAccountField = (label, key, options, disabled = false) => {
        if (isAccountLegacy(formData[key])) {
            return (
                <div>
                    <label className="form-label">{label}</label>
                    <div className="journal-account-legacy">
                        <span>{formatAccountOption(formData[key])}</span>
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
                    value={formData[key]}
                    onChange={(event) => setFormData((prev) => ({ ...prev, [key]: event.target.value }))}
                    disabled={isView || disabled}
                >
                    {options.map((account) => (
                        <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                    ))}
                </select>
            </div>
        );
    };

    const handleSaveDebit = () => {
        if (!formData.linkedReturnId || formData.lines.length === 0) {
            window.alert('Create debit note from a purchase return draft or open an existing debit note.');
            return;
        }

        if (formData.settlementType === 'Apply to Bill' && !formData.settlementRef) {
            window.alert('Select the bill to apply this debit note.');
            return;
        }

        if (Number(totals.total || formData.amount || 0) <= 0) {
            window.alert('Debit amount must be greater than zero.');
            return;
        }

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0 && isAccountLegacy(line.accountId))
            .map((line) => formatAccountOption(line.accountId));
        if (invalidPostingAccounts.length > 0) {
            window.alert(`Cannot save debit note. Posting account is inactive/legacy:\n- ${invalidPostingAccounts.join('\n- ')}`);
            return;
        }

        const debitNumber = numberingMode === 'auto' ? debitNoPreview : formData.debitNumber || debitNoPreview;
        setFormData((prev) => ({ ...prev, debitNumber }));

        const notePayload = {
            id: debitNumber,
            date: formData.debitDate,
            returnId: formData.linkedReturnId,
            vendorId: formData.vendorId,
            vendorName: formData.vendorName,
            sourceBillId: formData.sourceBillId,
            settlementType: formData.settlementType,
            settlementRef: formData.settlementRef,
            settlementAccountId: formData.settlementAccountId,
            apAccountId: formData.apAccountId,
            returnAccountId: formData.returnAccountId,
            taxAccountId: formData.taxAccountId,
            amount: totals.total || formData.amount,
            applyTax: formData.applyTax,
            status: 'Applied',
        };

        if (mode === 'edit' && formData.debitNumber) {
            updateDebitNoteMutation.mutate({ id: formData.debitNumber, ...notePayload });
        } else {
            createDebitNote.mutate(notePayload);
        }
        navigate('/ap/debits');
    };

    return (
        <FormPage
            containerClassName="ap-module"
            title="Debit Note"
            backTo="/ap/debits"
            actions={
                <>
                    <Button text="Print" variant="secondary" />
                    <Button text="Save Draft" variant="secondary" />
                    <Button text={isView ? 'Close' : 'Save Debit Note'} variant="primary" onClick={isView ? () => navigate('/ap/debits') : handleSaveDebit} />
                </>
            }
        >
            <div className="module-status-strip">
                <div className="module-status-meta">
                    <div className="module-status-number">{formData.debitNumber || 'DBN-XXXX'}</div>
                    <StatusTag status={isView ? 'Completed' : 'Draft'} label={isView ? 'Posted' : 'Draft'} />
                </div>
                <div className="module-status-total">{formatIDR(totals.total || formData.amount)}</div>
            </div>

            <div className="invoice-panel no-top-margin">
                <div className="grid-12 form-grid-tight">
                    <div className="col-span-3">
                        <label className="form-label">Debit #</label>
                        <div className="numbering-row">
                            <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={numberingMode} onChange={(event) => setNumberingMode(event.target.value)} disabled={isView}>
                                <option value="auto">Auto</option>
                                <option value="manual">Manual</option>
                            </select>
                            <Input className="mb-0" value={formData.debitNumber} onChange={(event) => setFormData((prev) => ({ ...prev, debitNumber: event.target.value }))} disabled={isView || numberingMode === 'auto'} placeholder={debitNoPreview} />
                        </div>
                        {numberingMode === 'auto' ? <div className="numbering-preview">Assigned on save • Preview: {debitNoPreview}</div> : null}
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Debit Date</label>
                        <Input className="mb-0" type="date" value={formData.debitDate} onChange={(event) => setFormData((prev) => ({ ...prev, debitDate: event.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-3">
                        <label className="form-label">Linked Purchase Return</label>
                        <Input className="mb-0" value={formData.linkedReturnId} disabled />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Vendor</label>
                        <Input className="mb-0" value={formData.vendorName} disabled />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Source Bill</label>
                        <Input className="mb-0" value={formData.sourceBillId} disabled />
                    </div>
                </div>
            </div>

            <div className="invoice-panel panel-no-padding mt-12">
                <div className="panel-section-title">Return Lines</div>
                <table className="module-table">
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th className="text-right">Qty Return</th>
                            <th>Unit</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {formData.lines.length === 0 ? (
                            <tr><td colSpan={5} className="module-empty-state">No linked return lines.</td></tr>
                        ) : formData.lines.map((line, index) => (
                            <tr key={`${line.lineKey || index}`} className="row-border">
                                <td>{line.description}</td>
                                <td className="text-right">{line.qtyReturn}</td>
                                <td>{line.unit}</td>
                                <td className="text-right">{formatIDR(line.price)}</td>
                                <td className="text-right text-strong">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="invoice-panel mt-12">
                <div className="grid-12 form-grid-start">
                    <div className="col-span-8">
                        <label className="form-label">Settlement</label>
                        <div className="panel-box">
                            <div className="settlement-mode-row">
                                <label className="radio-inline">
                                    <input type="radio" name="settlementType" value="Apply to Bill" checked={formData.settlementType === 'Apply to Bill'} onChange={(event) => setFormData((prev) => ({ ...prev, settlementType: event.target.value, settlementRef: '' }))} disabled={isView} />
                                    Apply to open bill
                                </label>
                                <label className="radio-inline">
                                    <input type="radio" name="settlementType" value="Refund from Vendor" checked={formData.settlementType === 'Refund from Vendor'} onChange={(event) => setFormData((prev) => ({ ...prev, settlementType: event.target.value, settlementRef: '' }))} disabled={isView} />
                                    Refund from vendor
                                </label>
                            </div>

                            {formData.settlementType === 'Apply to Bill' ? (
                                <div className="grid-12 form-grid-start">
                                    <div className="col-span-6">
                                        <label className="form-label">Apply To Bill</label>
                                        <select className={fcBase} value={formData.settlementRef} onChange={(event) => setFormData((prev) => ({ ...prev, settlementRef: event.target.value }))} disabled={isView}>
                                            <option value="">Select bill...</option>
                                            {openBillsForVendor.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid-12 form-grid-start">
                                    <div className="col-span-6">
                                        <label className="form-label">Refund Bank / Cash</label>
                                        <select className={fcBase} value={formData.refundBankId} onChange={(event) => setFormData((prev) => ({ ...prev, refundBankId: event.target.value }))} disabled={isView}>
                                            {bankAccounts.map((account) => (
                                                <option key={account.id} value={account.id}>{account.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <label className="form-label">Refund Method</label>
                                        <select className={fcBase} value={formData.refundMethod} onChange={(event) => setFormData((prev) => ({ ...prev, refundMethod: event.target.value }))} disabled={isView}>
                                            <option>Bank Transfer</option>
                                            <option>Cash</option>
                                            <option>Check</option>
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <label className="form-label">Reference</label>
                                        <Input className="mb-0" value={formData.settlementRef} onChange={(event) => setFormData((prev) => ({ ...prev, settlementRef: event.target.value }))} placeholder="Refund reference" disabled={isView} />
                                    </div>
                                </div>
                            )}

                            <div className="grid-12 form-grid-start mt-12">
                                <div className="col-span-4">{renderAccountField('A/P Account (DR)', 'apAccountId', apAccountOptions, formData.settlementType !== 'Apply to Bill')}</div>
                                <div className="col-span-4">{renderAccountField('Return Account (CR)', 'returnAccountId', returnAccountOptions)}</div>
                                <div className="col-span-4">{renderAccountField('Tax Account (CR)', 'taxAccountId', taxAccountOptions, !formData.applyTax)}</div>
                                {formData.settlementType === 'Refund from Vendor' ? (
                                    <div className="col-span-4">{renderAccountField('Refund Account (DR)', 'settlementAccountId', settlementAccountOptions)}</div>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="col-span-4">
                        <label className="form-label">Summary</label>
                        <div className="panel-box panel-box-tight">
                            <div className="panel-summary-row"><span>Subtotal</span><strong>{formatIDR(totals.subtotal)}</strong></div>
                            <div className="panel-summary-row"><span>Tax ({formData.applyTax ? `${formData.taxRate}%` : '0%'})</span><strong>{formatIDR(formData.applyTax ? totals.taxAmount : 0)}</strong></div>
                            <div className="panel-summary-total"><span className="label">Debit Amount</span><span className="value">{formatIDR(totals.total || formData.amount)}</span></div>
                        </div>
                    </div>

                    <div className="col-span-12">
                        <label className="form-label">Internal Note</label>
                        <textarea className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed resize-y" rows={3} value={formData.note} onChange={(event) => setFormData((prev) => ({ ...prev, note: event.target.value }))} disabled={isView} />
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

export default DebitNoteForm;
