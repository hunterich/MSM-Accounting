import React, { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import { useBankAccounts } from '../../hooks/useBanking';
import { useInvoices } from '../../hooks/useAR';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useCreditNotes, useSalesReturns, useCreateCreditNote, useUpdateCreditNote } from '../../hooks/useReturns';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';

const buildCreditNo = (dateStr, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `CRN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const toReturnTotals = (ret) => {
    if (!ret) return { subtotal: 0, taxAmount: 0, total: 0 };
    const subtotal = (ret.lines || []).reduce((sum, line) => sum + (Number(line.qtyReturn || 0) * Number(line.price || 0)), 0);
    if (!ret.applyTax) return { subtotal, taxAmount: 0, total: subtotal };
    const taxRate = Number(ret.taxRate || 0) / 100;
    if (ret.taxIncluded) {
        const base = subtotal / (1 + taxRate);
        return { subtotal, taxAmount: subtotal - base, total: subtotal };
    }
    const taxAmount = subtotal * taxRate;
    return { subtotal, taxAmount, total: subtotal + taxAmount };
};

const BANK_TO_ACCOUNT_MAP = {
    'BANK-001': 'COA-1120',
    'BANK-002': 'COA-1130',
    'BANK-003': 'COA-1110'
};

const CreditNoteForm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { data: bankAccounts = [] } = useBankAccounts();
    const { data: invoicesData } = useInvoices();
    const invoices = invoicesData?.data ?? [];
    const { data: chartOfAccounts = [] } = useChartOfAccounts();
    const { data: cnData } = useCreditNotes();
    const creditNotes = cnData?.data ?? [];
    const { data: srData } = useSalesReturns();
    const salesReturns = srData?.data ?? [];
    const createCreditNote = useCreateCreditNote();
    const updateCreditNoteMutation = useUpdateCreditNote();
    const state = location.state || {};
    const mode = state.mode || 'create'; // create | view | edit
    const isView = mode === 'view';

    const [numberingMode, setNumberingMode] = useState('auto');
    const [formData, setFormData] = useState({
        creditNumber: '',
        creditDate: new Date().toISOString().split('T')[0],
        linkedReturnId: '',
        customerName: '',
        sourceInvoiceId: '',
        settlementType: 'Apply to Invoice',
        settlementRef: '',
        refundBankId: bankAccounts[0]?.id || '',
        refundMethod: 'Bank Transfer',
        arAccountId: 'COA-1210',
        returnAccountId: 'COA-5300',
        taxAccountId: 'COA-2200',
        settlementAccountId: 'COA-1120',
        note: '',
        amount: 0,
        lines: [],
        applyTax: true,
        taxIncluded: false,
        taxRate: 11
    });

    useEffect(() => {
        if (state.returnDraft) {
            const draft = state.returnDraft;
            const customerInvoice = invoices.find((inv) => inv.id === draft.invoiceId);
            setNumberingMode('auto');
            setFormData((prev) => ({
                ...prev,
                creditDate: draft.returnDate || prev.creditDate,
                linkedReturnId: draft.returnNumber,
                customerName: customerInvoice?.customerName || '',
                sourceInvoiceId: draft.invoiceId,
                arAccountId: draft.arAccountId || prev.arAccountId,
                returnAccountId: draft.returnAccountId || prev.returnAccountId,
                taxAccountId: draft.taxAccountId || prev.taxAccountId,
                settlementAccountId: draft.arAccountId || prev.settlementAccountId,
                amount: toReturnTotals(draft).total,
                lines: draft.lines || [],
                applyTax: draft.applyTax,
                taxIncluded: draft.taxIncluded,
                taxRate: draft.taxRate
            }));
            return;
        }

        if (state.creditId) {
            const found = creditNotes.find((cn) => cn.id === state.creditId);
            if (!found) return;
            const linkedReturn = salesReturns.find((ret) => ret.id === found.returnId);
            setNumberingMode('manual');
            setFormData((prev) => ({
                ...prev,
                creditNumber: found.id,
                creditDate: found.date,
                linkedReturnId: found.returnId,
                customerName: found.customerName,
                sourceInvoiceId: found.sourceInvoiceId,
                settlementType: found.settlementType,
                settlementRef: found.settlementRef || '',
                refundBankId: found.refundBankId || prev.refundBankId,
                refundMethod: found.refundMethod || prev.refundMethod,
                arAccountId: found.arAccountId || prev.arAccountId,
                returnAccountId: found.returnAccountId || prev.returnAccountId,
                taxAccountId: found.taxAccountId || prev.taxAccountId,
                settlementAccountId: found.settlementAccountId || prev.settlementAccountId,
                amount: found.amount,
                lines: linkedReturn?.lines || [],
                applyTax: found.applyTax,
                taxIncluded: linkedReturn?.taxIncluded ?? false,
                taxRate: linkedReturn?.taxRate ?? 11
            }));
        }
    }, [state.returnDraft, state.creditId]);

    useEffect(() => {
        if (formData.settlementType !== 'Refund') return;
        const mappedAccountId = BANK_TO_ACCOUNT_MAP[formData.refundBankId];
        if (!mappedAccountId) return;
        setFormData((prev) => {
            if (prev.settlementAccountId === mappedAccountId) return prev;
            return { ...prev, settlementAccountId: mappedAccountId };
        });
    }, [formData.refundBankId, formData.settlementType]);

    const creditNoPreview = useMemo(() => buildCreditNo(formData.creditDate, creditNotes.length + 1), [formData.creditDate]);

    const accountMap = useMemo(() => {
        return chartOfAccounts.reduce((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, []);

    const arAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, []);

    const returnAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Expense');
    }, []);

    const taxAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Liability');
    }, []);

    const settlementAccountOptions = useMemo(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, []);

    const openInvoicesForCustomer = useMemo(() => {
        if (!formData.sourceInvoiceId) return [];
        const source = invoices.find((inv) => inv.id === formData.sourceInvoiceId);
        if (!source) return [];
        return invoices
            .filter((inv) => inv.customerId === source.customerId)
            .filter((inv) => inv.status !== 'Paid')
            .map((inv) => ({ value: inv.id, label: `${inv.id} • ${formatDateID(inv.date)} • ${formatIDR(inv.amount)}` }));
    }, [formData.sourceInvoiceId]);

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
        const lines = [
            {
                side: 'DR',
                accountId: formData.returnAccountId,
                amount: totals.subtotal
            }
        ];

        if (formData.applyTax && totals.taxAmount > 0) {
            lines.push({
                side: 'DR',
                accountId: formData.taxAccountId,
                amount: totals.taxAmount
            });
        }

        lines.push({
            side: 'CR',
            accountId: formData.settlementType === 'Apply to Invoice' ? formData.arAccountId : formData.settlementAccountId,
            amount: totals.total
        });

        return lines;
    }, [
        formData.returnAccountId,
        formData.taxAccountId,
        formData.arAccountId,
        formData.settlementAccountId,
        formData.settlementType,
        formData.applyTax,
        totals.subtotal,
        totals.taxAmount,
        totals.total
    ]);

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
                        <option key={account.id} value={account.id}>
                            {account.code} - {account.name}
                        </option>
                    ))}
                </select>
            </div>
        );
    };

    const handleSaveCredit = () => {
        if (!formData.linkedReturnId || formData.lines.length === 0) {
            window.alert('Create credit note from a sales return draft or open an existing credit note.');
            return;
        }

        if (formData.settlementType === 'Apply to Invoice' && !formData.settlementRef) {
            window.alert('Select the invoice to apply this credit note.');
            return;
        }

        if (Number(totals.total || formData.amount || 0) <= 0) {
            window.alert('Credit amount must be greater than zero.');
            return;
        }

        const invalidPostingAccounts = postingPreview
            .filter((line) => Number(line.amount || 0) > 0 && isAccountLegacy(line.accountId))
            .map((line) => formatAccountOption(line.accountId));
        if (invalidPostingAccounts.length > 0) {
            window.alert(
                `Cannot save credit note. Posting account is inactive/legacy:\n- ${invalidPostingAccounts.join('\n- ')}`
            );
            return;
        }

        const creditNumber = numberingMode === 'auto' ? creditNoPreview : formData.creditNumber || creditNoPreview;
        setFormData((prev) => ({ ...prev, creditNumber }));

        const notePayload = {
            id: creditNumber,
            date: formData.creditDate,
            returnId: formData.linkedReturnId,
            customerName: formData.customerName,
            sourceInvoiceId: formData.sourceInvoiceId,
            settlementType: formData.settlementType,
            settlementRef: formData.settlementRef,
            refundBankId: formData.refundBankId,
            refundMethod: formData.refundMethod,
            arAccountId: formData.arAccountId,
            returnAccountId: formData.returnAccountId,
            taxAccountId: formData.taxAccountId,
            settlementAccountId: formData.settlementAccountId,
            amount: totals.total || formData.amount,
            applyTax: formData.applyTax,
            status: 'Applied',
        };

        if (mode === 'edit' && formData.creditNumber) {
            updateCreditNoteMutation.mutate({ id: formData.creditNumber, ...notePayload });
        } else {
            createCreditNote.mutate(notePayload);
        }
        navigate('/ar/credits');
    };

    return (
        <FormPage
            containerClassName="ar-module"
            title="Credit Note"
            backTo="/ar/credits"
            actions={(
                <>
                    <Button text="Print" variant="secondary" />
                    <Button text="Save Draft" variant="secondary" />
                    <Button text={isView ? 'Close' : 'Save Credit Note'} variant="primary" onClick={isView ? () => navigate('/ar/credits') : handleSaveCredit} />
                </>
            )}
        >

            <div className="module-status-strip">
                <div className="module-status-meta">
                    <div className="module-status-number">{formData.creditNumber || 'CRN-XXXX'}</div>
                    <StatusTag status={isView ? 'Completed' : 'Draft'} label={isView ? 'Posted' : 'Draft'} />
                </div>
                <div className="module-status-total">{formatIDR(totals.total || formData.amount)}</div>
            </div>

            <div className="invoice-panel no-top-margin">
                <div className="grid-12 form-grid-tight">
                    <div className="col-span-3">
                        <label className="form-label">Credit #</label>
                        <div className="numbering-row">
                            <select className="h-10 px-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed w-[90px] shrink-0" value={numberingMode} onChange={(e) => setNumberingMode(e.target.value)} disabled={isView}>
                                <option value="auto">Auto</option>
                                <option value="manual">Manual</option>
                            </select>
                            <Input className="mb-0" value={formData.creditNumber} onChange={(e) => setFormData((prev) => ({ ...prev, creditNumber: e.target.value }))} disabled={isView || numberingMode === 'auto'} placeholder={creditNoPreview} />
                        </div>
                        {numberingMode === 'auto' && (
                            <div className="numbering-preview">
                                Assigned on save • Preview: {creditNoPreview}
                            </div>
                        )}
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Credit Date</label>
                        <Input className="mb-0" type="date" value={formData.creditDate} onChange={(e) => setFormData((prev) => ({ ...prev, creditDate: e.target.value }))} disabled={isView} />
                    </div>
                    <div className="col-span-3">
                        <label className="form-label">Linked Sales Return</label>
                        <Input className="mb-0" value={formData.linkedReturnId} disabled />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Customer</label>
                        <Input className="mb-0" value={formData.customerName} disabled />
                    </div>
                    <div className="col-span-2">
                        <label className="form-label">Source Invoice</label>
                        <Input className="mb-0" value={formData.sourceInvoiceId} disabled />
                    </div>
                </div>
            </div>

            <div className="invoice-panel panel-no-padding mt-12">
                <div className="panel-section-title">Return Lines</div>
                <table className="module-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th className="text-right">Qty Return</th>
                            <th>Unit</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {formData.lines.length === 0 && (
                            <tr>
                                <td colSpan={5} className="module-empty-state">
                                    No linked return lines.
                                </td>
                            </tr>
                        )}
                        {formData.lines.map((line, idx) => (
                            <tr key={`${line.itemId}-${idx}`} className="row-border">
                                <td>{line.itemName}</td>
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
                                    <input type="radio" name="settlementType" value="Apply to Invoice" checked={formData.settlementType === 'Apply to Invoice'} onChange={(e) => setFormData((prev) => ({ ...prev, settlementType: e.target.value, settlementRef: '' }))} disabled={isView} />
                                    Apply to open invoice
                                </label>
                                <label className="radio-inline">
                                    <input type="radio" name="settlementType" value="Refund" checked={formData.settlementType === 'Refund'} onChange={(e) => setFormData((prev) => ({ ...prev, settlementType: e.target.value, settlementRef: '' }))} disabled={isView} />
                                    Refund to customer
                                </label>
                            </div>

                            {formData.settlementType === 'Apply to Invoice' ? (
                                <div className="grid-12 form-grid-start">
                                    <div className="col-span-6">
                                        <label className="form-label">Apply To Invoice</label>
                                        <select className={fcBase} value={formData.settlementRef} onChange={(e) => setFormData((prev) => ({ ...prev, settlementRef: e.target.value }))} disabled={isView}>
                                            <option value="">Select invoice...</option>
                                            {openInvoicesForCustomer.map((opt) => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid-12 form-grid-start">
                                    <div className="col-span-6">
                                        <label className="form-label">Refund Bank / Cash</label>
                                        <select className={fcBase} value={formData.refundBankId} onChange={(e) => setFormData((prev) => ({ ...prev, refundBankId: e.target.value }))} disabled={isView}>
                                            {bankAccounts.map((acc) => (
                                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <label className="form-label">Refund Method</label>
                                        <select className={fcBase} value={formData.refundMethod} onChange={(e) => setFormData((prev) => ({ ...prev, refundMethod: e.target.value }))} disabled={isView}>
                                            <option>Bank Transfer</option>
                                            <option>Cash</option>
                                            <option>Check</option>
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <label className="form-label">Reference</label>
                                        <Input className="mb-0" value={formData.settlementRef} onChange={(e) => setFormData((prev) => ({ ...prev, settlementRef: e.target.value }))} placeholder="Refund reference" disabled={isView} />
                                    </div>
                                </div>
                            )}

                            <div className="grid-12 form-grid-start mt-12">
                                <div className="col-span-4">
                                    {renderAccountField('Return Account (DR)', 'returnAccountId', returnAccountOptions)}
                                </div>
                                <div className="col-span-4">
                                    {renderAccountField('Tax Account (DR)', 'taxAccountId', taxAccountOptions, !formData.applyTax)}
                                </div>
                                <div className="col-span-4">
                                    {formData.settlementType === 'Apply to Invoice'
                                        ? renderAccountField('A/R Account (CR)', 'arAccountId', arAccountOptions)
                                        : renderAccountField('Refund Account (CR)', 'settlementAccountId', settlementAccountOptions)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="col-span-4">
                        <label className="form-label">Summary</label>
                        <div className="panel-box panel-box-tight">
                            <div className="panel-summary-row">
                                <span>Subtotal</span>
                                <strong>{formatIDR(totals.subtotal)}</strong>
                            </div>
                            <div className="panel-summary-row">
                                <span>Tax ({formData.applyTax ? `${formData.taxRate}%` : '0%'})</span>
                                <strong>{formatIDR(formData.applyTax ? totals.taxAmount : 0)}</strong>
                            </div>
                            <div className="panel-summary-total">
                                <span className="label">Credit Amount</span>
                                <span className="value">{formatIDR(totals.total || formData.amount)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="col-span-12">
                        <label className="form-label">Internal Note</label>
                        <textarea className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed resize-y" rows={3} value={formData.note} onChange={(e) => setFormData((prev) => ({ ...prev, note: e.target.value }))} disabled={isView} />
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
        </FormPage>
    );
};

export default CreditNoteForm;
