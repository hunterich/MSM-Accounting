import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { useBankAccounts, useCreateBankAccount, useCreateBankTransaction } from '../../hooks/useBanking';
import { bankingActionSchema, zodToFormErrors } from '../../utils/formSchemas';

interface SelectFieldProps {
    label?:    string;
    name:      string;
    value:     string;
    onChange:  React.ChangeEventHandler<HTMLSelectElement>;
    error?:    string | null;
    disabled?: boolean;
    children:  React.ReactNode;
}
import { useChartOfAccounts } from '../../hooks/useGL';
import FormPage from '../../components/Layout/FormPage';

// ─── Helpers ───────────────────────────────────────────────────────────────

const getActionFromPath = (path) => {
    if (path.includes('transfer')) return 'transfer';
    if (path.includes('expense'))  return 'expense';
    if (path.includes('income'))   return 'income';
    return 'account';
};

const ACTION_TITLES = {
    transfer: 'Bank Transfer',
    expense:  'Record Expense',
    income:   'Record Income',
    account:  'Add Bank Account',
};

/**
 * SelectField — wraps label + select in a form-group div so it aligns
 * perfectly with the Input component inside the grid.
 */
const SelectField = ({ label, name, value, onChange, error, disabled, children }) => (
    <div>
        {label && <label className="form-label">{label}</label>}
        <select
            className={`w-full h-10 px-3 rounded-md border bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed ${error ? 'border-danger-500' : 'border-neutral-300'}`}
            name={name}
            value={value}
            onChange={onChange}
            disabled={disabled}
        >
            {children}
        </select>
        {error && <div className="form-feedback invalid-feedback">{error}</div>}
    </div>
);

const buildInitialState = (expenseAccounts, incomeAccounts) => ({
    // ── Transfer fields
    fromAccountId: '',
    toAccountId:   '',
    // ── Expense fields
    paidFromId:       '',
    expenseAccountId: expenseAccounts[0]?.id || '',
    payee:            '',
    // ── Income fields
    depositToId:    '',
    incomeAccountId: incomeAccounts[0]?.id || '',
    receivedFrom:   '',
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

// ─── Component ─────────────────────────────────────────────────────────────

const BankingActionForm = () => {
    const location = useLocation();
    const navigate  = useNavigate();
    const action    = getActionFromPath(location.pathname);
    const sourceTransaction = location.state?.transaction || null;

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

    const [formData, setFormData] = useState(() => buildInitialState(expenseAccounts, incomeAccounts));
    const [errors, setErrors]     = useState({});

    useEffect(() => {
        if (!sourceTransaction) return;
        setFormData((prev) => ({
            ...prev,
            amount: String(Math.abs(Number(sourceTransaction.amount || 0))),
            date: sourceTransaction.date || prev.date,
            reference: sourceTransaction.id || prev.reference,
            description: sourceTransaction.description || prev.description,
            ...(action === 'transfer' ? { fromAccountId: sourceTransaction.accountId || prev.fromAccountId } : {}),
            ...(action === 'expense' ? { paidFromId: sourceTransaction.accountId || prev.paidFromId } : {}),
            ...(action === 'income' ? { depositToId: sourceTransaction.accountId || prev.depositToId } : {})
        }));
    }, [sourceTransaction?.id, action]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev)    => ({ ...prev, [name]: null }));
    };

    const isSaving = createAccount.isPending || createTransaction.isPending;
    const isPageLoading = chartOfAccountsLoading || accountsLoading;

    const handleSave = async () => {
        const result = bankingActionSchema(action).safeParse(formData);
        if (!result.success) { setErrors(zodToFormErrors(result.error)); return; }

        try {
            if (action === 'account') {
                await createAccount.mutateAsync(formData);
            } else {
                await createTransaction.mutateAsync({ action, formData });
            }
            navigate('/banking');
        } catch (err) {
            setErrors((prev) => ({ ...prev, _api: err.message || 'Save failed. Please try again.' }));
        }
    };

    // Computed tax amount for display
    const taxAmount = useMemo(() => {
        if (formData.taxType === 'none' || !formData.amount) return 0;
        return (Number(formData.amount) * Number(formData.taxRate)) / 100;
    }, [formData.taxType, formData.amount, formData.taxRate]);

    const totalWithTax = useMemo(() => {
        if (formData.taxType === 'none') return Number(formData.amount) || 0;
        return (Number(formData.amount) || 0) + taxAmount;
    }, [formData.amount, taxAmount, formData.taxType]);

    // ─── Shared bottom section (tax + notes) for expense & income ─────────
    const SharedFields = () => (
        <>
            {/* Row: Tax Type + Tax Rate + Cost Center */}
            <div className="col-span-3">
                <SelectField label="Tax / VAT" name="taxType" value={formData.taxType} onChange={handleChange}>
                    <option value="none">No Tax</option>
                    <option value="ppn">PPN (VAT)</option>
                    <option value="gst">GST</option>
                    <option value="withholding">Withholding Tax (PPh)</option>
                </SelectField>
            </div>

            {formData.taxType !== 'none' ? (
                <div className="col-span-2">
                    <Input
                        label="Tax Rate (%)"
                        name="taxRate"
                        type="number"
                        value={formData.taxRate}
                        onChange={handleChange}
                        error={errors.taxRate}
                    />
                </div>
            ) : (
                <div className="col-span-2" /> /* spacer */
            )}

            <div className="col-span-4">
                <Input
                    label="Cost Center / Dept."
                    name="costCenter"
                    value={formData.costCenter}
                    onChange={handleChange}
                    placeholder="e.g. Marketing, IT, Operations"
                />
            </div>

            {formData.taxType !== 'none' && (
                <div className="col-span-3 banking-tax-summary">
                    <div className="form-label">Tax Summary</div>
                    <div className="banking-tax-line">
                        <span>Base Amount</span>
                        <span>Rp {Number(formData.amount || 0).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="banking-tax-line">
                        <span>Tax ({formData.taxRate}%)</span>
                        <span>Rp {taxAmount.toLocaleString('id-ID')}</span>
                    </div>
                    <div className="banking-tax-line banking-tax-total">
                        <span>Total</span>
                        <span>Rp {totalWithTax.toLocaleString('id-ID')}</span>
                    </div>
                </div>
            )}

            {/* Row: Notes (full width) */}
            <div className="col-span-12">
                <div>
                    <label className="form-label">Notes / Internal Memo</label>
                    <textarea
                        className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 resize-y"
                        name="notes"
                        rows={2}
                        value={formData.notes}
                        onChange={handleChange}
                        placeholder="Internal notes — not visible on documents"
                        style={{ resize: 'vertical', minHeight: 64 }}
                    />
                </div>
            </div>
        </>
    );

    return (
        <FormPage
            containerClassName="banking-module"
            title={ACTION_TITLES[action]}
            backTo="/banking"
            backLabel="Back to Banking"
            isLoading={isPageLoading}
            actions={
                <>
                    <Button text="Cancel" variant="secondary" onClick={() => navigate('/banking')} />
                    <Button text="Save" variant="primary" onClick={handleSave} disabled={isSaving} />
                </>
            }
        >
            <div className="invoice-panel panel-primary-top">

                {errors._api && (
                    <div className="col-span-12 mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                        {errors._api}
                    </div>
                )}

                {/* ── Add Bank Account ────────────────────────────────── */}
                {action === 'account' && (
                    <>
                        <div className="invoice-panel-header">
                            <span className="invoice-panel-title">Account Details</span>
                        </div>
                        <div className="grid-12 form-grid-start">
                            <div className="col-span-5">
                                <Input
                                    label="Account Nickname *"
                                    name="accountNickname"
                                    value={formData.accountNickname}
                                    onChange={handleChange}
                                    placeholder="e.g. BCA Operational"
                                    error={errors.accountNickname}
                                />
                            </div>
                            <div className="col-span-4">
                                <Input
                                    label="Bank Name"
                                    name="bankName"
                                    value={formData.bankName}
                                    onChange={handleChange}
                                    placeholder="e.g. BCA"
                                />
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Account Number / Last 4"
                                    name="last4"
                                    value={formData.last4}
                                    onChange={handleChange}
                                    placeholder="e.g. 1234-567-890 or ••••4589"
                                    error={errors.last4}
                                />
                            </div>
                            <div className="col-span-4">
                                <Input
                                    label="Opening Balance"
                                    name="openingBalance"
                                    type="number"
                                    value={formData.openingBalance}
                                    onChange={handleChange}
                                    placeholder="0"
                                    error={errors.openingBalance}
                                />
                            </div>
                            <div className="col-span-3">
                                <SelectField label="Currency" name="currency" value={formData.currency} onChange={handleChange}>
                                    <option value="IDR">IDR — Indonesian Rupiah</option>
                                    <option value="USD">USD — US Dollar</option>
                                    <option value="SGD">SGD — Singapore Dollar</option>
                                    <option value="EUR">EUR — Euro</option>
                                </SelectField>
                            </div>
                        </div>
                    </>
                )}

                {/* ── Bank Transfer ────────────────────────────────────── */}
                {action === 'transfer' && (
                    <>
                        <div className="invoice-panel-header">
                            <span className="invoice-panel-title">Transfer Details</span>
                        </div>
                        <div className="grid-12 form-grid-start">
                            {/* Row 1: From → To */}
                            <div className="col-span-6">
                                <SelectField
                                    label="From Account *"
                                    name="fromAccountId"
                                    value={formData.fromAccountId}
                                    onChange={handleChange}
                                    error={errors.fromAccountId}
                                    disabled={accountsLoading}
                                >
                                    <option value="">— Select Account —</option>
                                    {bankAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className="col-span-6">
                                <SelectField
                                    label="To Account *"
                                    name="toAccountId"
                                    value={formData.toAccountId}
                                    onChange={handleChange}
                                    error={errors.toAccountId}
                                    disabled={accountsLoading}
                                >
                                    <option value="">— Select Account —</option>
                                    {bankAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </SelectField>
                            </div>

                            {/* Row 2: Amount + Date + Reference */}
                            <div className="col-span-4">
                                <Input
                                    label="Amount *"
                                    name="amount"
                                    type="number"
                                    value={formData.amount}
                                    onChange={handleChange}
                                    placeholder="0"
                                    error={errors.amount}
                                />
                            </div>
                            <div className="col-span-4">
                                <Input
                                    label="Transfer Date *"
                                    name="date"
                                    type="date"
                                    value={formData.date}
                                    onChange={handleChange}
                                    error={errors.date}
                                />
                            </div>
                            <div className="col-span-4">
                                <Input
                                    label="Reference No."
                                    name="reference"
                                    value={formData.reference}
                                    onChange={handleChange}
                                    placeholder="e.g. TRF-001"
                                />
                            </div>

                            {/* Row 3: Description + Notes */}
                            <div className="col-span-6">
                                <Input
                                    label="Description"
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    placeholder="Purpose of this transfer"
                                />
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="Cost Center / Dept."
                                    name="costCenter"
                                    value={formData.costCenter}
                                    onChange={handleChange}
                                    placeholder="e.g. Finance, Operations"
                                />
                            </div>

                            {/* Row 4: Notes */}
                            <div className="col-span-12">
                                <div>
                                    <label className="form-label">Internal Notes</label>
                                    <textarea
                                        className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 resize-y"
                                        name="notes"
                                        rows={2}
                                        value={formData.notes}
                                        onChange={handleChange}
                                        placeholder="Optional internal memo"
                                        style={{ resize: 'vertical', minHeight: 64 }}
                                    />
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* ── Record Expense ───────────────────────────────────── */}
                {action === 'expense' && (
                    <>
                        <div className="invoice-panel-header">
                            <span className="invoice-panel-title">Expense Details</span>
                        </div>
                        <div className="grid-12 form-grid-start">
                            {/* Row 1: Paid From + Payee */}
                            <div className="col-span-6">
                                <SelectField
                                    label="Paid From *"
                                    name="paidFromId"
                                    value={formData.paidFromId}
                                    onChange={handleChange}
                                    error={errors.paidFromId}
                                    disabled={accountsLoading}
                                >
                                    <option value="">— Select Account —</option>
                                    {bankAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="Payee / Vendor"
                                    name="payee"
                                    value={formData.payee}
                                    onChange={handleChange}
                                    placeholder="e.g. Telkom Indonesia"
                                />
                            </div>

                            {/* Row 2: Expense Account + Amount + Date */}
                            <div className="col-span-5">
                                <SelectField
                                    label="Expense Account"
                                    name="expenseAccountId"
                                    value={formData.expenseAccountId}
                                    onChange={handleChange}
                                    error={errors.expenseAccountId}
                                >
                                    {expenseAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className="col-span-4">
                                <Input
                                    label="Amount *"
                                    name="amount"
                                    type="number"
                                    value={formData.amount}
                                    onChange={handleChange}
                                    placeholder="0"
                                    error={errors.amount}
                                />
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Expense Date *"
                                    name="date"
                                    type="date"
                                    value={formData.date}
                                    onChange={handleChange}
                                    error={errors.date}
                                />
                            </div>

                            {/* Row 3: Reference + Description */}
                            <div className="col-span-4">
                                <Input
                                    label="Reference / Receipt No."
                                    name="reference"
                                    value={formData.reference}
                                    onChange={handleChange}
                                    placeholder="e.g. RCP-2026-001"
                                />
                            </div>
                            <div className="col-span-8">
                                <Input
                                    label="Description"
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    placeholder="What was this expense for?"
                                />
                            </div>

                            {/* Row 4: Tax + Cost Center + Tax Summary */}
                            <SharedFields />
                        </div>
                    </>
                )}

                {/* ── Record Income ────────────────────────────────────── */}
                {action === 'income' && (
                    <>
                        <div className="invoice-panel-header">
                            <span className="invoice-panel-title">Income Details</span>
                        </div>
                        <div className="grid-12 form-grid-start">
                            {/* Row 1: Deposit To + Received From */}
                            <div className="col-span-6">
                                <SelectField
                                    label="Deposit To *"
                                    name="depositToId"
                                    value={formData.depositToId}
                                    onChange={handleChange}
                                    error={errors.depositToId}
                                    disabled={accountsLoading}
                                >
                                    <option value="">— Select Account —</option>
                                    {bankAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className="col-span-6">
                                <Input
                                    label="Received From"
                                    name="receivedFrom"
                                    value={formData.receivedFrom}
                                    onChange={handleChange}
                                    placeholder="e.g. Customer name or source"
                                />
                            </div>

                            {/* Row 2: Revenue Account + Amount + Date */}
                            <div className="col-span-5">
                                <SelectField
                                    label="Revenue Account"
                                    name="incomeAccountId"
                                    value={formData.incomeAccountId}
                                    onChange={handleChange}
                                    error={errors.incomeAccountId}
                                >
                                    {incomeAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className="col-span-4">
                                <Input
                                    label="Amount *"
                                    name="amount"
                                    type="number"
                                    value={formData.amount}
                                    onChange={handleChange}
                                    placeholder="0"
                                    error={errors.amount}
                                />
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Date Received *"
                                    name="date"
                                    type="date"
                                    value={formData.date}
                                    onChange={handleChange}
                                    error={errors.date}
                                />
                            </div>

                            {/* Row 3: Reference + Description */}
                            <div className="col-span-4">
                                <Input
                                    label="Reference / Invoice No."
                                    name="reference"
                                    value={formData.reference}
                                    onChange={handleChange}
                                    placeholder="e.g. INV-1001"
                                />
                            </div>
                            <div className="col-span-8">
                                <Input
                                    label="Description"
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    placeholder="What is this income for?"
                                />
                            </div>

                            {/* Row 4: Tax + Cost Center + Tax Summary */}
                            <SharedFields />
                        </div>
                    </>
                )}

            </div>
        </FormPage>
    );
};

export default BankingActionForm;
