import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import type { Account, DebitNote, PurchaseReturn } from '../../types';

interface DebitNoteLine {
    lineKey?:    string;
    description: string;
    qtyReturn:   number;
    unit:        string;
    price:       number;
}

interface DebitNoteFormData {
    debitNumber:         string;
    debitDate:           string;
    linkedReturnId:      string;
    vendorId:            string;
    vendorName:          string;
    sourceBillId:        string;
    settlementType:      string;
    settlementRef:       string;
    refundBankId:        string;
    refundMethod:        string;
    settlementAccountId: string;
    apAccountId:         string;
    returnAccountId:     string;
    taxAccountId:        string;
    note:                string;
    amount:              number;
    lines:               DebitNoteLine[];
    applyTax:            boolean;
    taxIncluded:         boolean;
    taxRate:             number;
}
import { useBankAccounts } from '../../hooks/useBanking';
import { useBills } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useDebitNotes, usePurchaseReturns, useCreateDebitNote, useUpdateDebitNote } from '../../hooks/useReturns';
import { formatDateID, formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { resolveAccountDefaults, resolveBankLinkedAssetAccountId } from '../../../lib/account-defaults';

interface DebitNoteLocationState {
    returnDraft?: PurchaseReturn;
    debitId?: string;
    mode?: 'create' | 'edit' | 'view';
}

interface ReturnTotals {
    subtotal: number;
    taxAmount: number;
    total: number;
}

interface PostingPreviewLine {
    side: 'DR' | 'CR';
    accountId: string;
    amount: number;
}

interface SelectOption {
    value: string;
    label: string;
}

type AccountFieldKey = 'apAccountId' | 'returnAccountId' | 'taxAccountId' | 'settlementAccountId';

const buildDebitNo = (dateStr?: string, seq = 1) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `DBN/${yyyy}/${mm}/${String(seq).padStart(5, '0')}`;
};

const toReturnTotals = (purchaseReturn?: PurchaseReturn | null): ReturnTotals => {
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
    const { data: bankAccounts = [], isLoading: bankAccountsLoading } = useBankAccounts();
    const { data: billsData, isLoading: billsLoading } = useBills();
    const bills = billsData?.data ?? [];
    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const { data: dnData, isLoading: debitNotesLoading } = useDebitNotes();
    const debitNotes = dnData?.data ?? [];
    const { data: prData, isLoading: purchaseReturnsLoading } = usePurchaseReturns();
    const purchaseReturns = prData?.data ?? [];
    const accountDefaultsConfig = useSettingsStore((s) => s.accountDefaults);
    const createDebitNote = useCreateDebitNote();
    const updateDebitNoteMutation = useUpdateDebitNote();
    const state = (location.state || {}) as DebitNoteLocationState;
    const mode = state.mode || 'create';
    const isView = mode === 'view';
    const resolvedAccountDefaults = useMemo(
        () => resolveAccountDefaults(chartOfAccounts, accountDefaultsConfig),
        [chartOfAccounts, accountDefaultsConfig]
    );

    const [numberingMode, setNumberingMode] = useState('auto');
    const [formData, setFormData] = useState<DebitNoteFormData>({
        debitNumber: '',
        debitDate: new Date().toISOString().split('T')[0],
        linkedReturnId: '',
        vendorId: '',
        vendorName: '',
        sourceBillId: '',
        settlementType: 'Apply to Bill',
        settlementRef: '',
        refundBankId: '',
        refundMethod: 'Bank Transfer',
        settlementAccountId: '',
        apAccountId: '',
        returnAccountId: '',
        taxAccountId: '',
        note: '',
        amount: 0,
        lines: [],
        applyTax: true,
        taxIncluded: false,
        taxRate: 11
    });

    const accountMap = useMemo<Record<string, Account>>(() => {
        return chartOfAccounts.reduce<Record<string, Account>>((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const apAccountOptions = useMemo<Account[]>(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Liability');
    }, [chartOfAccounts]);

    const returnAccountOptions = useMemo<Account[]>(() => {
        return chartOfAccounts.filter(
            (account) =>
                account.isActive && account.isPostable && (account.type === 'Expense' || account.type === 'Asset')
        );
    }, [chartOfAccounts]);

    const taxAccountOptions = useMemo<Account[]>(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, [chartOfAccounts]);

    const settlementAccountOptions = useMemo<Account[]>(() => {
        return chartOfAccounts.filter((account) => account.isActive && account.isPostable && account.type === 'Asset');
    }, [chartOfAccounts]);

    useEffect(() => {
        if (state.returnDraft) {
            const draft = state.returnDraft;
            const sourceBill = bills.find((item) => item.id === draft.billId);
            setNumberingMode('auto');
            setFormData((prev) => ({
                ...prev,
                debitDate: draft.returnDate || prev.debitDate,
                linkedReturnId: draft.number || draft.id,
                vendorId: draft.vendorId,
                vendorName: sourceBill?.vendor || '',
                sourceBillId: draft.billId,
                settlementRef: '',
                apAccountId: draft.apAccountId || prev.apAccountId || resolvedAccountDefaults.apControl,
                returnAccountId: draft.returnAccountId || prev.returnAccountId || resolvedAccountDefaults.apReturn,
                taxAccountId: draft.taxAccountId || prev.taxAccountId || resolvedAccountDefaults.apTax,
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
                settlementAccountId: found.settlementAccountId || prev.settlementAccountId || resolvedAccountDefaults.bankAsset,
                apAccountId: found.apAccountId || prev.apAccountId || resolvedAccountDefaults.apControl,
                returnAccountId: found.returnAccountId || prev.returnAccountId || resolvedAccountDefaults.apReturn,
                taxAccountId: found.taxAccountId || prev.taxAccountId || resolvedAccountDefaults.apTax,
                amount: found.amount,
                lines: linkedReturn?.lines || [],
                applyTax: found.applyTax,
                taxIncluded: linkedReturn?.taxIncluded ?? false,
                taxRate: linkedReturn?.taxRate ?? 11
            }));
        }
    }, [state.returnDraft, state.debitId, resolvedAccountDefaults]);

    useEffect(() => {
        if (state.debitId) return;
        if (formData.settlementType !== 'Refund from Vendor') return;
        const mappedAccountId = resolveBankLinkedAssetAccountId(bankAccounts, chartOfAccounts, accountDefaultsConfig, formData.refundBankId);
        if (!mappedAccountId) return;
        setFormData((prev) => (prev.settlementAccountId === mappedAccountId ? prev : { ...prev, settlementAccountId: mappedAccountId }));
    }, [state.debitId, formData.refundBankId, formData.settlementType, bankAccounts, chartOfAccounts, accountDefaultsConfig]);

    useEffect(() => {
        if (!formData.refundBankId && bankAccounts[0]?.id) {
            setFormData((prev) => ({ ...prev, refundBankId: prev.refundBankId || bankAccounts[0].id }));
        }
    }, [bankAccounts, formData.refundBankId]);

    useEffect(() => {
        if (state.debitId) return;
        setFormData((prev) => {
            let changed = false;
            const next = { ...prev };

            if (!next.settlementAccountId && resolvedAccountDefaults.bankAsset) {
                next.settlementAccountId = resolvedAccountDefaults.bankAsset;
                changed = true;
            }
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
    }, [state.debitId, resolvedAccountDefaults]);

    const debitNoPreview = useMemo(() => buildDebitNo(formData.debitDate, debitNotes.length + 1), [formData.debitDate, debitNotes.length]);

    const openBillsForVendor = useMemo<SelectOption[]>(() => {
        if (!formData.vendorId) return [];
        return bills
            .filter((bill) => bill.vendorId === formData.vendorId)
            .filter((bill) => bill.status !== 'Paid')
            .map((bill) => ({ value: bill.id, label: `${bill.id} • ${formatDateID(bill.date)} • ${formatIDR(bill.amount)}` }));
    }, [bills, formData.vendorId]);

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

    const formatAccountOption = (accountId: string) => {
        const account = accountMap[accountId];
        return account ? `${account.code} - ${account.name}` : 'Unknown account';
    };

    const isAccountLegacy = (accountId: string) => {
        const account = accountMap[accountId];
        return !account || !account.isActive || !account.isPostable;
    };

    const postingPreview = useMemo<PostingPreviewLine[]>(() => {
        const debitAccountId = formData.settlementType === 'Apply to Bill' ? formData.apAccountId : formData.settlementAccountId;
        const lines: PostingPreviewLine[] = [{ side: 'DR', accountId: debitAccountId, amount: totals.total }];

        lines.push({ side: 'CR', accountId: formData.returnAccountId, amount: totals.subtotal });
        if (formData.applyTax && totals.taxAmount > 0) {
            lines.push({ side: 'CR', accountId: formData.taxAccountId, amount: totals.taxAmount });
        }

        return lines;
    }, [formData.settlementType, formData.apAccountId, formData.settlementAccountId, formData.returnAccountId, formData.taxAccountId, formData.applyTax, totals.subtotal, totals.taxAmount, totals.total]);

    const fcBase = 'w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm text-neutral-900 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed';

    const renderAccountField = (label: string, key: AccountFieldKey, options: Account[], disabled = false) => {
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

        const notePayload: Partial<DebitNote> = {
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

    const isPageLoading =
        bankAccountsLoading ||
        billsLoading ||
        chartOfAccountsLoading ||
        debitNotesLoading ||
        purchaseReturnsLoading;

    return (
        <FormPage
            containerClassName="ap-module"
            title="Debit Note"
            backTo="/ap/debits"
            isLoading={isPageLoading}
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
                    <div className="module-status-number">{formData.debitNumber || 'Otomatis'}</div>
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
                        {numberingMode === 'auto' ? <div className="numbering-preview">Nomor ditetapkan server saat disimpan</div> : null}
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
