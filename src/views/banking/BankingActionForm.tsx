import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Landmark } from 'lucide-react';

import DocumentFormLayout from '../../components/documents/DocumentFormLayout';
import SearchableSelect from '../../components/UI/SearchableSelect';
import ClosedPeriodBanner from '../../components/UI/ClosedPeriodBanner';
import { useBankAccounts, useBankTransactions, useCreateBankAccount, useCreateBankTransaction } from '../../hooks/useBanking';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { bankingActionSchema, zodToFormErrors } from '../../utils/formSchemas';
import { formatIDR, terbilang } from '../../utils/formatters';
import type { BankAccount } from '../../types';
import { getActionFromPath, ACTION_TITLES } from './bankingAction';
import { calculateBankAmounts } from '../../../lib/bank-amounts';

/**
 * BankingActionForm — Payment, Receive, Bank Transfer and Add Bank Account.
 *
 * Rendered on the shared document-form shell (DocumentFormLayout) so it looks
 * and behaves like Sales Order / Invoice / Bill: same action bar, same header
 * card + field typography, and a sticky right rail with the money summary and
 * the bank-account context (balance before → after this transaction).
 */

interface BankingActionFormData {
    fromAccountId: string;
    toAccountId: string;
    paidFromId: string;
    expenseAccountId: string;
    payee: string;
    depositToId: string;
    incomeAccountId: string;
    receivedFrom: string;
    amount: string;
    date: string;
    reference: string;
    description: string;
    taxType: string;
    taxRate: string;
    costCenter: string;
    notes: string;
    accountNickname: string;
    bankName: string;
    last4: string;
    openingBalance: string;
    currency: string;
}

type BankingActionErrors = Record<string, string | null | undefined>;

const buildInitialState = (): BankingActionFormData => ({
    // ── Transfer fields
    fromAccountId: '',
    toAccountId:   '',
    // ── Expense fields
    paidFromId:       '',
    expenseAccountId: '',
    payee:            '',
    // ── Income fields
    depositToId:     '',
    incomeAccountId: '',
    receivedFrom:    '',
    // ── Shared transaction fields
    amount:      '',
    date:        new Date().toISOString().slice(0, 10),
    reference:   '',
    description: '',
    taxType:     'none',   // none | gst | ppn | withholding
    taxRate:     '11',
    costCenter:  '',
    notes:       '',
    // ── Add Account fields
    accountNickname: '',
    bankName:        '',
    last4:           '',
    openingBalance:  '',
    currency:        'IDR',
});

/** Fields that, once touched, make the form "dirty" (unsaved). */
const DIRTY_FIELDS: Array<keyof BankingActionFormData> = [
    'fromAccountId', 'toAccountId', 'paidFromId', 'payee', 'depositToId', 'receivedFrom',
    'amount', 'reference', 'description', 'costCenter', 'notes',
    'accountNickname', 'bankName', 'last4', 'openingBalance',
];

// ── Shared field styling (matches SOFormV2 / document forms) ──────────────────
const lbl = 'block mb-1 text-[12px] font-medium text-neutral-700';
const ctlBase = 'w-full h-9 px-2.5 text-[13px] text-neutral-900 bg-white border rounded-md focus:border-primary-500 focus:outline-0 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-100 disabled:cursor-not-allowed';
const ctl = (error?: string | null) => `${ctlBase} ${error ? 'border-danger-500' : 'border-neutral-300'}`;
const card = 'bg-neutral-0 border border-neutral-200 rounded-lg p-4';
const cardTitle = 'text-[11px] uppercase tracking-wide text-neutral-500 font-semibold mb-3';

const Req = () => <span className="text-danger-500">*</span>;
const FieldError = ({ error }: { error?: string | null }) =>
    error ? <div className="mt-1 text-[12px] text-danger-600">{error}</div> : null;

interface FieldProps {
    label: React.ReactNode;
    error?: string | null;
    hint?: React.ReactNode;
    children: React.ReactNode;
}
const Field = ({ label, error, hint, children }: FieldProps) => (
    <div>
        <label className={lbl}>{label}</label>
        {children}
        <FieldError error={error} />
        {!error && hint && <div className="mt-1 text-[11px] text-neutral-500">{hint}</div>}
    </div>
);

/** SearchableSelect with an inline error / hint, sized to sit in the header grid. */
const AccountSelect = ({
    label, value, onChange, options, placeholder, error, hint, disabled,
}: {
    label: React.ReactNode;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string; subLabel?: string }[];
    placeholder: string;
    error?: string | null;
    hint?: React.ReactNode;
    disabled?: boolean;
}) => (
    <div>
        <SearchableSelect
            className="!mb-0"
            label={label}
            options={options}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
        />
        <FieldError error={error} />
        {!error && hint && <div className="mt-1 text-[11px] text-neutral-500">{hint}</div>}
    </div>
);

const SummaryRow = ({ k, v, strong, brand, negative }: { k: string; v: number; strong?: boolean; brand?: boolean; negative?: boolean }) => (
    <div className="flex justify-between items-baseline gap-3">
        <span className={strong ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>{k}</span>
        <span className={`tabular-nums ${brand ? 'font-bold text-primary-700 text-lg' : strong ? 'font-semibold text-neutral-900' : 'text-neutral-900'} ${negative && v < 0 ? '!text-danger-600' : ''}`}>
            {formatIDR(v)}
        </span>
    </div>
);

/** Rail card: one bank account's balance before → after this transaction. */
const AccountImpact = ({ title, account, delta }: { title: string; account?: BankAccount; delta: number }) => {
    if (!account) {
        return (
            <div className={`${card} text-sm text-neutral-500`}>
                <div className={cardTitle}>{title}</div>
                Select an account to see its balance.
            </div>
        );
    }
    const after = account.balance + delta;
    const overdrawn = delta < 0 && after < 0;
    return (
        <div className={card}>
            <div className={cardTitle}>{title}</div>
            <div className="flex items-center gap-2 mb-3">
                <span className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500">
                    <Landmark size={14} />
                </span>
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-neutral-900 leading-tight truncate">{account.name}</div>
                    <div className="text-[11px] text-neutral-500 truncate">
                        {[account.bankName, account.accountNumber].filter(Boolean).join(' · ') || account.currency}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-2 text-[13px]">
                <SummaryRow k="Current balance" v={account.balance} />
                <SummaryRow k="This transaction" v={delta} negative />
                <div className="border-t border-neutral-200 mt-1 pt-2">
                    <SummaryRow k="Balance after" v={after} strong negative />
                </div>
            </div>
            {overdrawn && (
                <div className="mt-3 flex items-start gap-2 p-2.5 rounded-md bg-warning-50 border border-warning-200 text-[12px] text-warning-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>This will take the account below zero by {formatIDR(Math.abs(after))}.</span>
                </div>
            )}
        </div>
    );
};

// ─── Component ─────────────────────────────────────────────────────────────

interface BankingActionFormProps { action?: ReturnType<typeof getActionFromPath>; sourceTransactionId?: string; workspaceTabId?: string }

const BankingActionForm = ({ action: actionProp, sourceTransactionId, workspaceTabId }: BankingActionFormProps = {}) => {
    const location = useLocation();
    const navigate  = useNavigate();
    // In the workspace, identity comes from the owning tab (props), not the URL
    // path / router state, which are global and race across keep-alive tabs.
    const inWorkspace = workspaceTabId != null;
    const action    = inWorkspace ? (actionProp ?? 'expense') : getActionFromPath(location.pathname);
    // When editing/matching in the workspace, look the source txn up by id.
    const { data: wsTxnResult } = useBankTransactions(inWorkspace && sourceTransactionId ? {} : undefined);
    const sourceTransaction = inWorkspace
        ? (sourceTransactionId ? (wsTxnResult?.data ?? []).find((t: { id: string }) => t.id === sourceTransactionId) ?? null : null)
        : (location.state?.transaction || null);

    // ── API hooks
    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const { data: bankAccounts = [], isLoading: accountsLoading } = useBankAccounts();
    const createAccount     = useCreateBankAccount();
    const createTransaction = useCreateBankTransaction();

    const expenseAccounts = useMemo(
        () => chartOfAccounts.filter((a) => a.type === 'Expense' && a.isActive && a.isPostable),
        [chartOfAccounts]
    );
    const incomeAccounts = useMemo(
        () => chartOfAccounts.filter((a) => a.type === 'Revenue' && a.isActive && a.isPostable),
        [chartOfAccounts]
    );

    const [formData, setFormData] = useState<BankingActionFormData>(buildInitialState);
    const [errors, setErrors]     = useState<BankingActionErrors>({});

    // Default the GL account to the first postable one once the chart loads
    // (the chart arrives async, so it can't be seeded in the initial state).
    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            expenseAccountId: prev.expenseAccountId || expenseAccounts[0]?.id || '',
            incomeAccountId:  prev.incomeAccountId  || incomeAccounts[0]?.id  || '',
        }));
    }, [expenseAccounts, incomeAccounts]);

    useEffect(() => {
        if (!sourceTransaction) return;
        setFormData((prev) => ({
            ...prev,
            amount: sourceTransaction.baseAmount ?? String(Math.abs(sourceTransaction.amount)),
            taxType: sourceTransaction.taxType || prev.taxType,
            taxRate: String(sourceTransaction.taxRate ?? prev.taxRate),
            date: sourceTransaction.date || prev.date,
            reference: sourceTransaction.id || prev.reference,
            description: sourceTransaction.description || prev.description,
            ...(action === 'transfer' ? { fromAccountId: sourceTransaction.accountId || prev.fromAccountId,
                toAccountId: sourceTransaction.toAccountId || prev.toAccountId } : {}),
            ...(action === 'expense' ? { paidFromId: sourceTransaction.accountId || prev.paidFromId } : {}),
            ...(action === 'income' ? { depositToId: sourceTransaction.accountId || prev.depositToId } : {})
        }));
    }, [sourceTransaction?.id, action]);

    const setField = (name: keyof BankingActionFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev)    => ({ ...prev, [name]: null, _api: null }));
    };
    const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setField(event.target.name as keyof BankingActionFormData, event.target.value);

    const isSaving = createAccount.isPending || createTransaction.isPending;
    const isPageLoading = chartOfAccountsLoading || accountsLoading;

    // ── Money ───────────────────────────────────────────────────────────────
    const amounts = calculateBankAmounts({
        type: action.toUpperCase(), amount: formData.amount.trim() || 0,
        taxType: formData.taxType.toUpperCase(), taxRate: formData.taxRate.trim() || 0,
    });
    const baseAmount = amounts.base.toNumber();
    const taxAmount = amounts.tax.toNumber();
    const total = amounts.cash.toNumber();
    const hasTax = action !== 'transfer' && action !== 'account' && formData.taxType === 'ppn';

    // ── Options ─────────────────────────────────────────────────────────────
    const bankOptions = useMemo(
        () => bankAccounts.map((a) => ({
            value: a.id,
            label: a.name,
            subLabel: formatIDR(a.balance),
        })),
        [bankAccounts],
    );
    const glOptions = (list: typeof expenseAccounts) => list.map((a) => ({
        value: a.id,
        label: `${a.code} — ${a.name}`,
    }));
    const expenseOptions = useMemo(() => glOptions(expenseAccounts), [expenseAccounts]);
    const incomeOptions  = useMemo(() => glOptions(incomeAccounts), [incomeAccounts]);

    const accountById = (id: string) => bankAccounts.find((a) => a.id === id);
    const balanceHint = (id: string) => {
        const a = accountById(id);
        return a ? <>Balance <span className="tabular-nums">{formatIDR(a.balance)}</span></> : null;
    };

    // ── Workspace tab status ────────────────────────────────────────────────
    const initial = useMemo(buildInitialState, []);
    const dirty = DIRTY_FIELDS.some((k) => formData[k] !== initial[k]);

    // A banking entry posts on save (no draft state), so its tab stays "new"
    // until saved — same as a new Sales Order.

    const setStatus  = useWorkspaceStore((s) => s.setStatus);
    const closeTab   = useWorkspaceStore((s) => s.closeTab);
    const clearDraft = useWorkspaceStore((s) => s.clearDraft);
    useEffect(() => {
        if (!workspaceTabId) return;
        setStatus(workspaceTabId, 'new');
    }, [workspaceTabId, setStatus]);

    // ── Save ────────────────────────────────────────────────────────────────
    const persist = async (): Promise<boolean> => {
        const result = bankingActionSchema(action).safeParse(formData);
        if (!result.success) { setErrors(zodToFormErrors(result.error)); return false; }

        try {
            if (action === 'account') {
                await createAccount.mutateAsync(formData);
            } else {
                await createTransaction.mutateAsync({ action, formData });
            }
            return true;
        } catch (err) {
            setErrors((prev) => ({
                ...prev,
                _api: err instanceof Error ? err.message : 'Save failed. Please try again.'
            }));
            return false;
        }
    };

    const handleSave = async () => {
        if (!(await persist())) return;
        if (workspaceTabId) {
            clearDraft(workspaceTabId);
            closeTab(workspaceTabId);
        } else {
            navigate('/banking');
        }
    };

    /** Save, then start a fresh entry of the same kind — keeps the bank account and date. */
    const handleSaveAndNew = async () => {
        if (!(await persist())) return;
        setFormData((prev) => ({
            ...buildInitialState(),
            date: prev.date,
            fromAccountId: prev.fromAccountId,
            paidFromId: prev.paidFromId,
            depositToId: prev.depositToId,
            expenseAccountId: prev.expenseAccountId,
            incomeAccountId: prev.incomeAccountId,
        }));
        setErrors({});
    };

    // ── Sections ────────────────────────────────────────────────────────────
    const amountField = (label: string) => (
        <Field label={<>{label} <Req /></>} error={errors.amount}>
            <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-neutral-500">Rp</span>
                <input
                    type="number" min="0" name="amount" inputMode="decimal"
                    className={`${ctl(errors.amount)} pl-8 text-right tabular-nums`}
                    value={formData.amount} onChange={handleChange} placeholder="0"
                />
            </div>
        </Field>
    );

    const dateField = (label: string) => (
        <Field label={<>{label} <Req /></>} error={errors.date}>
            <input type="date" name="date" className={ctl(errors.date)} value={formData.date} onChange={handleChange} />
        </Field>
    );

    const header = (() => {
        if (action === 'transfer') {
            return (
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-6">
                        <AccountSelect
                            label={<>From account <Req /></>}
                            options={bankOptions} value={formData.fromAccountId}
                            onChange={(v) => setField('fromAccountId', v)}
                            placeholder="Select source account…"
                            error={errors.fromAccountId} hint={balanceHint(formData.fromAccountId)}
                            disabled={accountsLoading}
                        />
                    </div>
                    <div className="col-span-3">{dateField('Transfer date')}</div>
                    <div className="col-span-3">{amountField('Amount')}</div>
                    <div className="col-span-6">
                        <AccountSelect
                            label={<>To account <Req /></>}
                            options={bankOptions.filter((o) => o.value !== formData.fromAccountId)}
                            value={formData.toAccountId}
                            onChange={(v) => setField('toAccountId', v)}
                            placeholder="Select destination account…"
                            error={errors.toAccountId} hint={balanceHint(formData.toAccountId)}
                            disabled={accountsLoading}
                        />
                    </div>
                    <div className="col-span-6">
                        <Field label="Description">
                            <input name="description" className={ctl()} value={formData.description} onChange={handleChange} placeholder="Purpose of this transfer" />
                        </Field>
                    </div>
                </div>
            );
        }

        const isExpense = action === 'expense';
        const bankKey = isExpense ? 'paidFromId' : 'depositToId';
        const glKey = isExpense ? 'expenseAccountId' : 'incomeAccountId';
        const partyKey = isExpense ? 'payee' : 'receivedFrom';
        return (
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-6">
                    <AccountSelect
                        label={<>{isExpense ? 'Paid from' : 'Deposit to'} <Req /></>}
                        options={bankOptions} value={formData[bankKey]}
                        onChange={(v) => setField(bankKey, v)}
                        placeholder="Select cash / bank account…"
                        error={errors[bankKey]} hint={balanceHint(formData[bankKey])}
                        disabled={accountsLoading}
                    />
                </div>
                <div className="col-span-3">{dateField(isExpense ? 'Payment date' : 'Date received')}</div>
                <div className="col-span-3">{amountField('Amount')}</div>
                <div className="col-span-6">
                    <AccountSelect
                        label={<>{isExpense ? 'Expense account' : 'Revenue account'} <Req /></>}
                        options={isExpense ? expenseOptions : incomeOptions}
                        value={formData[glKey]}
                        onChange={(v) => setField(glKey, v)}
                        placeholder={isExpense ? 'Select expense account…' : 'Select revenue account…'}
                        error={errors[glKey]}
                        disabled={chartOfAccountsLoading}
                    />
                </div>
                <div className="col-span-6">
                    <Field label={isExpense ? 'Payee / vendor' : 'Received from'}>
                        <input
                            name={partyKey} className={ctl()} value={formData[partyKey]} onChange={handleChange}
                            placeholder={isExpense ? 'e.g. Telkom Indonesia' : 'e.g. Customer name or source'}
                        />
                    </Field>
                </div>
            </div>
        );
    })();

    const details = action === 'transfer' ? (
        <div className={card}>
            <div className={cardTitle}>Additional info</div>
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-6">
                    <Field label="Reference no.">
                        <input name="reference" className={ctl()} value={formData.reference} onChange={handleChange} placeholder="e.g. TRF-001" />
                    </Field>
                </div>
                <div className="col-span-6">
                    <Field label="Cost center / dept.">
                        <input name="costCenter" className={ctl()} value={formData.costCenter} onChange={handleChange} placeholder="e.g. Finance, Operations" />
                    </Field>
                </div>
            </div>
        </div>
    ) : (
        <div className={card}>
            <div className={cardTitle}>Additional info</div>
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                    <Field label={action === 'expense' ? 'Reference / receipt no.' : 'Reference / invoice no.'}>
                        <input
                            name="reference" className={ctl()} value={formData.reference} onChange={handleChange}
                            placeholder={action === 'expense' ? 'e.g. RCP-2026-001' : 'e.g. INV-1001'}
                        />
                    </Field>
                </div>
                <div className="col-span-4">
                    <Field label="Cost center / dept.">
                        <input name="costCenter" className={ctl()} value={formData.costCenter} onChange={handleChange} placeholder="e.g. Marketing, IT, Operations" />
                    </Field>
                </div>
                <div className={formData.taxType !== 'none' ? 'col-span-2' : 'col-span-4'}>
                    <Field label="Tax / VAT">
                        <select name="taxType" className={ctl()} value={formData.taxType} onChange={handleChange}>
                            <option value="none">No tax</option>
                            <option value="ppn">PPN (VAT)</option>
                            <option value="gst">GST</option>
                            <option value="withholding">Withholding (PPh)</option>
                        </select>
                    </Field>
                </div>
                {formData.taxType !== 'none' && (
                    <div className="col-span-2">
                        <Field label="Rate (%)" error={errors.taxRate}>
                            <input type="number" name="taxRate" className={`${ctl(errors.taxRate)} text-right`} value={formData.taxRate} onChange={handleChange} />
                        </Field>
                    </div>
                )}
                <div className="col-span-12">
                    <Field label="Description">
                        <input
                            name="description" className={ctl()} value={formData.description} onChange={handleChange}
                            placeholder={action === 'expense' ? 'What was this payment for?' : 'What is this receipt for?'}
                        />
                    </Field>
                </div>
            </div>
        </div>
    );

    const notes = (
        <div className={card}>
            <label className={lbl}>Internal notes</label>
            <textarea
                name="notes" className={`${ctl()} h-[68px] py-2 resize-y`}
                value={formData.notes} onChange={handleChange}
                placeholder="Internal memo — not visible on documents"
            />
        </div>
    );

    const accountForm = (
        <div className={card}>
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-6">
                    <Field label={<>Account nickname <Req /></>} error={errors.accountNickname}>
                        <input name="accountNickname" className={ctl(errors.accountNickname)} value={formData.accountNickname} onChange={handleChange} placeholder="e.g. BCA Operational" />
                    </Field>
                </div>
                <div className="col-span-3">
                    <Field label="Bank name">
                        <input name="bankName" className={ctl()} value={formData.bankName} onChange={handleChange} placeholder="e.g. BCA" />
                    </Field>
                </div>
                <div className="col-span-3">
                    <Field label="Currency">
                        <select name="currency" className={ctl()} value={formData.currency} onChange={handleChange}>
                            <option value="IDR">IDR — Indonesian Rupiah</option>
                            <option value="USD">USD — US Dollar</option>
                            <option value="SGD">SGD — Singapore Dollar</option>
                            <option value="EUR">EUR — Euro</option>
                        </select>
                    </Field>
                </div>
                <div className="col-span-6">
                    <Field label="Account number / last 4" error={errors.last4}>
                        <input name="last4" className={ctl(errors.last4)} value={formData.last4} onChange={handleChange} placeholder="e.g. 1234-567-890 or ••••4589" />
                    </Field>
                </div>
                <div className="col-span-6">
                    <Field label="Opening balance" error={errors.openingBalance}>
                        <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-neutral-500">Rp</span>
                            <input type="number" min="0" name="openingBalance" className={`${ctl(errors.openingBalance)} pl-8 text-right tabular-nums`} value={formData.openingBalance} onChange={handleChange} placeholder="0" />
                        </div>
                    </Field>
                </div>
            </div>
        </div>
    );

    const main = (
        <>
            {action !== 'account' && <ClosedPeriodBanner date={formData.date} />}
            {errors._api && (
                <div className="p-3 bg-danger-50 border border-danger-200 rounded-md text-[13px] text-danger-700">{errors._api}</div>
            )}
            {action === 'account' ? accountForm : (
                <>
                    <div className={card}>{header}</div>
                    {details}
                    {notes}
                </>
            )}
            {isPageLoading && <div className="text-[12px] text-neutral-500 px-1">Loading accounts…</div>}
        </>
    );

    // ── Rail ────────────────────────────────────────────────────────────────
    const summary = (
        <div className={card}>
            <div className={cardTitle}>Summary</div>
            <div className="flex flex-col gap-2 text-[13px]">
                {action === 'account' ? (
                    <SummaryRow k="Opening balance" v={Number(formData.openingBalance) || 0} brand />
                ) : (
                    <>
                        <SummaryRow k={action === 'transfer' ? 'Transfer amount' : 'Amount'} v={baseAmount} />
                        {hasTax && <SummaryRow k={`Tax (${formData.taxRate || 0}%)`} v={taxAmount} />}
                        <div className="border-t border-neutral-200 mt-1 pt-2">
                            <SummaryRow k="Total" v={total} brand />
                        </div>
                        <div className="text-[11px] text-neutral-500 italic leading-snug mt-1">
                            Terbilang: {terbilang(total)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    const rail = (
        <>
            {summary}
            {action === 'transfer' && (
                <>
                    <AccountImpact title="From account" account={accountById(formData.fromAccountId)} delta={-total} />
                    <AccountImpact title="To account" account={accountById(formData.toAccountId)} delta={total} />
                </>
            )}
            {action === 'expense' && <AccountImpact title="Paid from" account={accountById(formData.paidFromId)} delta={-total} />}
            {action === 'income' && <AccountImpact title="Deposit to" account={accountById(formData.depositToId)} delta={total} />}
        </>
    );

    return (
        <div className="p-0">
            <DocumentFormLayout
                title={ACTION_TITLES[action]}
                dirty={dirty}
                saving={isSaving}
                onBack={() => navigate('/banking')}
                backLabel="Cash & Bank"
                primaryLabel="Save"
                primaryIcon={<CheckCircle2 size={13} />}
                onPrimary={handleSave}
                primaryOptions={[
                    { label: 'Save & close', hint: action === 'account' ? 'Add the account' : 'Post to the ledger', onClick: handleSave },
                    { label: 'Save & new', hint: 'Save, then start another', onClick: handleSaveAndNew },
                ]}
                main={main}
                rail={rail}
            />
        </div>
    );
};

export default BankingActionForm;
