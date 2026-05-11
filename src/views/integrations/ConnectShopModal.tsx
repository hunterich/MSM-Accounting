import React, { useMemo, useState } from 'react';
import Modal from '../../components/UI/Modal';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { useCustomers, useCreateCustomer } from '../../hooks/useAR';
import { useBankAccounts, useCreateBankAccount } from '../../hooks/useBanking';
import { useAccountsByType } from '../../hooks/useGL';
import { useCreateEcommerceConnection } from '../../hooks/useIntegrations';
import { shopMappingsSchema } from '../../../types/api';
import type {
    EcommerceConnection,
    EcommercePlatform,
    ImportStatusFilter,
    ShopMappings,
    ShopPaymentMode,
} from '../../types';
import { X } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    existingShops: EcommerceConnection[];
    canCreate: boolean;
}

interface SelectOption { value: string; label: string }

type Tab = 'general' | 'shipping' | 'others';

const platformOptions: SelectOption[] = [
    { value: 'Shopee', label: 'Shopee Indonesia' },
    { value: 'TikTok', label: 'TikTok Shop' },
    { value: 'Tokopedia', label: 'Tokopedia' },
    { value: 'Lazada', label: 'Lazada' },
];

const emptyMappings = (): ShopMappings => ({
    paymentMode: 'settlement_import',
    vatInclusive: false,
    fees: {},
    shipping: {},
    others: { notes: '' },
});

const ConnectShopModal = ({ isOpen, onClose, existingShops, canCreate }: Props): React.ReactElement => {
    const [tab, setTab] = useState<Tab>('general');

    // Top-level connection fields
    const [platform, setPlatform] = useState<EcommercePlatform>('Shopee');
    const [name, setName] = useState('');
    const [customerId, setCustomerId] = useState('');
    const [holdingAccountId, setHoldingAccountId] = useState('');
    const [importStatusFilter, setImportStatusFilter] = useState<ImportStatusFilter>('Selesai');
    const [mappings, setMappings] = useState<ShopMappings>(emptyMappings());
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Inline quick-create state
    const [showNewCustomer, setShowNewCustomer] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerError, setNewCustomerError] = useState('');
    const [showNewAccount, setShowNewAccount] = useState(false);
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountBank, setNewAccountBank] = useState('');
    const [newAccountNumber, setNewAccountNumber] = useState('');
    const [newAccountError, setNewAccountError] = useState('');

    // Data
    const { data: customersData } = useCustomers();
    const customers = customersData?.data ?? [];
    const { data: bankAccounts = [] } = useBankAccounts();
    const { data: revenueAccounts = [] } = useAccountsByType('Revenue', { enabled: isOpen });
    const { data: expenseAccounts = [] } = useAccountsByType('Expense', { enabled: isOpen });
    const { data: liabilityAccounts = [] } = useAccountsByType('Liability', { enabled: isOpen });

    // Mutations
    const createConnection = useCreateEcommerceConnection();
    const createCustomer = useCreateCustomer();
    const createBankAccount = useCreateBankAccount();

    const customerOptions: SelectOption[] = useMemo(
        () => customers.map((c) => ({ value: c.id, label: c.name })),
        [customers]
    );
    const bankOptions: SelectOption[] = useMemo(
        () => bankAccounts.map((b) => ({ value: b.id, label: b.name })),
        [bankAccounts]
    );
    const revenueOptions: SelectOption[] = useMemo(
        () => revenueAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
        [revenueAccounts]
    );
    const expenseOptions: SelectOption[] = useMemo(
        () => expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
        [expenseAccounts]
    );
    const taxOptions: SelectOption[] = useMemo(
        () => [...liabilityAccounts, ...expenseAccounts].map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
        [liabilityAccounts, expenseAccounts]
    );
    const roundingOptions: SelectOption[] = useMemo(
        () => [...expenseAccounts, ...revenueAccounts].map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
        [expenseAccounts, revenueAccounts]
    );

    const reset = () => {
        setTab('general');
        setPlatform('Shopee');
        setName('');
        setCustomerId('');
        setHoldingAccountId('');
        setImportStatusFilter('Selesai');
        setMappings(emptyMappings());
        setErrors({});
        setShowNewCustomer(false); setNewCustomerName(''); setNewCustomerError('');
        setShowNewAccount(false); setNewAccountName(''); setNewAccountBank(''); setNewAccountNumber(''); setNewAccountError('');
    };

    const close = () => { reset(); onClose(); };

    const setMapping = <K extends keyof ShopMappings>(key: K, value: ShopMappings[K]) => {
        setMappings((prev) => ({ ...prev, [key]: value }));
    };
    const setFee = (key: keyof NonNullable<ShopMappings['fees']>, value: string | null) => {
        setMappings((prev) => ({ ...prev, fees: { ...(prev.fees ?? {}), [key]: value || null } }));
        setErrors((e) => ({ ...e, [`fees.${key}`]: '' }));
    };
    const setShipping = (key: keyof NonNullable<ShopMappings['shipping']>, value: string | null) => {
        setMappings((prev) => ({ ...prev, shipping: { ...(prev.shipping ?? {}), [key]: value || null } }));
    };
    const setOther = (key: keyof NonNullable<ShopMappings['others']>, value: string | null) => {
        setMappings((prev) => ({ ...prev, others: { ...(prev.others ?? {}), [key]: (value ?? '') as never } }));
    };

    const handleQuickCreateCustomer = async () => {
        const trimmed = newCustomerName.trim();
        if (!trimmed) { setNewCustomerError('Name is required.'); return; }
        const autoCode = trimmed.replace(/\s+/g, '-').toUpperCase().slice(0, 10);
        try {
            const created = await createCustomer.mutateAsync({ name: trimmed, code: autoCode }) as { id: string };
            setCustomerId(created.id);
            setShowNewCustomer(false);
            setNewCustomerName(''); setNewCustomerError('');
            setErrors((e) => ({ ...e, customerId: '' }));
        } catch (err) {
            setNewCustomerError(err instanceof Error ? err.message : 'Failed to create customer.');
        }
    };

    const handleQuickCreateAccount = async () => {
        if (!newAccountName.trim()) { setNewAccountError('Account name is required.'); return; }
        try {
            const created = await createBankAccount.mutateAsync({
                accountNickname: newAccountName.trim(),
                bankName: newAccountBank.trim(),
                last4: newAccountNumber.trim(),
                currency: 'IDR',
                openingBalance: '0',
            } as Parameters<typeof createBankAccount.mutateAsync>[0]);
            setHoldingAccountId((created as { id: string }).id);
            setShowNewAccount(false);
            setNewAccountName(''); setNewAccountBank(''); setNewAccountNumber(''); setNewAccountError('');
            setErrors((e) => ({ ...e, holdingAccountId: '' }));
        } catch (err) {
            setNewAccountError(err instanceof Error ? err.message : 'Failed to create account.');
        }
    };

    const validate = (): boolean => {
        const next: Record<string, string> = {};
        const trimmedName = name.trim();
        if (!trimmedName) next.name = 'Shop name is required.';
        if (!customerId) next.customerId = 'Default customer is required.';
        if (!holdingAccountId) next.holdingAccountId = 'Settlement account is required.';

        const dup = existingShops.some((s) =>
            s.platform === platform && s.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        if (dup) next.name = 'This shop already exists for the selected platform.';

        const parsed = shopMappingsSchema.safeParse(mappings);
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                next[issue.path.join('.')] = issue.message;
            }
        }

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSave = async () => {
        if (!validate()) {
            // Switch to the tab where the first error lives so the user sees it.
            if (errors['shipping.buyerShippingRevenueAccountId'] || Object.keys(errors).some((k) => k.startsWith('shipping.'))) {
                setTab('shipping');
            } else if (Object.keys(errors).some((k) => k.startsWith('others.'))) {
                setTab('others');
            }
            return;
        }
        try {
            await createConnection.mutateAsync({
                platform,
                name: name.trim(),
                customerId,
                holdingAccountId,
                status: 'Active',
                importStatusFilter,
                mappings,
            });
            close();
        } catch (err) {
            setErrors((e) => ({ ...e, _root: err instanceof Error ? err.message : 'Failed to save shop connection.' }));
        }
    };

    const tabBtn = (id: Tab, label: string) => (
        <button
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === id
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-neutral-600 hover:text-neutral-900'}`}
        >
            {label}
        </button>
    );

    const fieldErr = (k: string) =>
        errors[k] ? <div className="form-feedback invalid-feedback">{errors[k]}</div> : null;

    return (
        <Modal title="Connect New Shop" isOpen={isOpen} onClose={close} size="lg">
            <div className="border-b border-neutral-200 -mx-6 -mt-6 px-6 mb-4">
                <div className="flex gap-1">
                    {tabBtn('general', 'General')}
                    {tabBtn('shipping', 'Shipping & Fees')}
                    {tabBtn('others', 'Others')}
                </div>
            </div>

            {errors._root ? (
                <div className="mb-3 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                    {errors._root}
                </div>
            ) : null}

            {/* ── General ─────────────────────────────────────────────── */}
            {tab === 'general' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="form-label">Platform <span className="text-danger-600">*</span></label>
                            <select
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={platform}
                                onChange={(e) => setPlatform(e.target.value as EcommercePlatform)}
                            >
                                {platformOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Shop Name <span className="text-danger-600">*</span></label>
                            <Input
                                placeholder="e.g. MyShopeeStore_01"
                                value={name}
                                onChange={(e) => { setName(e.target.value); setErrors((er) => ({ ...er, name: '' })); }}
                            />
                            {fieldErr('name')}
                        </div>
                    </div>

                    <div>
                        <label className="form-label">Sales Payment Mode <span className="text-danger-600">*</span></label>
                        <div className="flex flex-col gap-2 mt-1">
                            <label className="flex items-start gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="paymentMode"
                                    checked={mappings.paymentMode === 'direct'}
                                    onChange={() => setMapping('paymentMode', 'direct' as ShopPaymentMode)}
                                    className="mt-0.5"
                                />
                                <span className="text-sm">
                                    <strong>Direct payment</strong>
                                    <span className="block text-neutral-500 text-xs">Sales are recorded as paid immediately.</span>
                                </span>
                            </label>
                            <label className="flex items-start gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="paymentMode"
                                    checked={mappings.paymentMode === 'settlement_import'}
                                    onChange={() => setMapping('paymentMode', 'settlement_import' as ShopPaymentMode)}
                                    className="mt-0.5"
                                />
                                <span className="text-sm">
                                    <strong>Pay via settlement import</strong>
                                    <span className="block text-neutral-500 text-xs">Sales are unpaid until you import the platform settlement file.</span>
                                </span>
                            </label>
                        </div>
                    </div>

                    {mappings.paymentMode === 'settlement_import' && (
                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Settlement fee accounts</div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="form-label">Seller Discount</label>
                                    <SearchableSelect
                                        options={expenseOptions}
                                        value={mappings.fees?.sellerDiscountAccountId ?? ''}
                                        onChange={(v) => setFee('sellerDiscountAccountId', v)}
                                        placeholder="Select expense account..."
                                    />
                                    {fieldErr('fees.sellerDiscountAccountId')}
                                </div>
                                <div>
                                    <label className="form-label">Shipping Variance (Over/Under)</label>
                                    <SearchableSelect
                                        options={expenseOptions}
                                        value={mappings.fees?.shippingVarianceAccountId ?? ''}
                                        onChange={(v) => setFee('shippingVarianceAccountId', v)}
                                        placeholder="Select expense account..."
                                    />
                                    {fieldErr('fees.shippingVarianceAccountId')}
                                </div>
                                <div>
                                    <label className="form-label">Platform Service & Add-ons</label>
                                    <SearchableSelect
                                        options={expenseOptions}
                                        value={mappings.fees?.platformFeeAccountId ?? ''}
                                        onChange={(v) => setFee('platformFeeAccountId', v)}
                                        placeholder="Select expense account..."
                                    />
                                    {fieldErr('fees.platformFeeAccountId')}
                                </div>
                                <div>
                                    <label className="form-label">Adjustment Fee</label>
                                    <SearchableSelect
                                        options={expenseOptions}
                                        value={mappings.fees?.adjustmentAccountId ?? ''}
                                        onChange={(v) => setFee('adjustmentAccountId', v)}
                                        placeholder="Select expense account..."
                                    />
                                    {fieldErr('fees.adjustmentAccountId')}
                                </div>
                                <div>
                                    <label className="form-label">Affiliate Fee</label>
                                    <SearchableSelect
                                        options={expenseOptions}
                                        value={mappings.fees?.affiliateFeeAccountId ?? ''}
                                        onChange={(v) => setFee('affiliateFeeAccountId', v)}
                                        placeholder="Select expense account..."
                                    />
                                    {fieldErr('fees.affiliateFeeAccountId')}
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="form-label">Settlement / Holding Account <span className="text-danger-600">*</span></label>
                        <SearchableSelect
                            options={bankOptions}
                            value={holdingAccountId}
                            onChange={(v) => { setHoldingAccountId(v); setErrors((er) => ({ ...er, holdingAccountId: '' })); setShowNewAccount(false); }}
                            placeholder="Select / leave blank to auto-create..."
                            footerAction={{ label: 'Add new account', onAction: () => { setShowNewAccount((v) => !v); setShowNewCustomer(false); } }}
                        />
                        {fieldErr('holdingAccountId')}
                        <span className="integrations-field-hint">Where platform funds are held before payout.</span>
                    </div>

                    {showNewAccount && (
                        <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New Account</span>
                                <button type="button" onClick={() => setShowNewAccount(false)} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                            </div>
                            <Input placeholder="Account name *" value={newAccountName} onChange={(e) => { setNewAccountName(e.target.value); setNewAccountError(''); }} className="mb-2" />
                            <Input placeholder="Bank name (optional)" value={newAccountBank} onChange={(e) => setNewAccountBank(e.target.value)} className="mb-2" />
                            <Input placeholder="Account number (optional)" value={newAccountNumber} onChange={(e) => setNewAccountNumber(e.target.value)} className="mb-2" />
                            {newAccountError && <div className="form-feedback invalid-feedback mb-2">{newAccountError}</div>}
                            <Button text={createBankAccount.isPending ? 'Creating...' : 'Create & Select'} variant="primary" size="small" disabled={createBankAccount.isPending} onClick={handleQuickCreateAccount} />
                        </div>
                    )}

                    <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={mappings.vatInclusive}
                                onChange={(e) => setMapping('vatInclusive', e.target.checked)}
                            />
                            <span className="text-sm">Sale prices already include VAT.</span>
                        </label>
                    </div>

                    <div>
                        <label className="form-label">Import Sales with Status</label>
                        <div className="flex gap-4 mt-1">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="importStatus"
                                    checked={importStatusFilter === 'Selesai'}
                                    onChange={() => setImportStatusFilter('Selesai')}
                                />
                                <span className="text-sm">Completed only</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="importStatus"
                                    checked={importStatusFilter === 'All'}
                                    onChange={() => setImportStatusFilter('All')}
                                />
                                <span className="text-sm">All statuses</span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className="form-label">Default Customer <span className="text-danger-600">*</span></label>
                        <SearchableSelect
                            options={customerOptions}
                            value={customerId}
                            onChange={(v) => { setCustomerId(v); setErrors((er) => ({ ...er, customerId: '' })); setShowNewCustomer(false); }}
                            placeholder="Select customer..."
                            footerAction={{ label: 'Add new customer', onAction: () => { setShowNewCustomer((v) => !v); setShowNewAccount(false); } }}
                        />
                        {fieldErr('customerId')}
                    </div>

                    {showNewCustomer && (
                        <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New Customer</span>
                                <button type="button" onClick={() => setShowNewCustomer(false)} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                            </div>
                            <Input placeholder="Customer name *" value={newCustomerName} onChange={(e) => { setNewCustomerName(e.target.value); setNewCustomerError(''); }} className="mb-2" />
                            {newCustomerError && <div className="form-feedback invalid-feedback mb-2">{newCustomerError}</div>}
                            <Button text={createCustomer.isPending ? 'Creating...' : 'Create & Select'} variant="primary" size="small" disabled={createCustomer.isPending} onClick={handleQuickCreateCustomer} />
                        </div>
                    )}
                </div>
            )}

            {/* ── Shipping & Fees ─────────────────────────────────────── */}
            {tab === 'shipping' && (
                <div className="space-y-3">
                    <p className="text-sm text-neutral-600">Map platform shipping line-items to your accounts. All optional — leave blank to skip.</p>
                    <div>
                        <label className="form-label">Buyer Shipping Revenue</label>
                        <SearchableSelect
                            options={revenueOptions}
                            value={mappings.shipping?.buyerShippingRevenueAccountId ?? ''}
                            onChange={(v) => setShipping('buyerShippingRevenueAccountId', v)}
                            placeholder="Select revenue account..."
                        />
                    </div>
                    <div>
                        <label className="form-label">Actual Shipping Cost</label>
                        <SearchableSelect
                            options={expenseOptions}
                            value={mappings.shipping?.actualShippingCostAccountId ?? ''}
                            onChange={(v) => setShipping('actualShippingCostAccountId', v)}
                            placeholder="Select expense account..."
                        />
                    </div>
                    <div>
                        <label className="form-label">Platform Shipping Subsidy</label>
                        <SearchableSelect
                            options={revenueOptions}
                            value={mappings.shipping?.platformShippingSubsidyAccountId ?? ''}
                            onChange={(v) => setShipping('platformShippingSubsidyAccountId', v)}
                            placeholder="Select revenue account..."
                        />
                    </div>
                    <div>
                        <label className="form-label">Shipping Insurance</label>
                        <SearchableSelect
                            options={expenseOptions}
                            value={mappings.shipping?.shippingInsuranceAccountId ?? ''}
                            onChange={(v) => setShipping('shippingInsuranceAccountId', v)}
                            placeholder="Select expense account..."
                        />
                    </div>
                    <div>
                        <label className="form-label">COD Fee</label>
                        <SearchableSelect
                            options={expenseOptions}
                            value={mappings.shipping?.codFeeAccountId ?? ''}
                            onChange={(v) => setShipping('codFeeAccountId', v)}
                            placeholder="Select expense account..."
                        />
                    </div>
                </div>
            )}

            {/* ── Others ──────────────────────────────────────────────── */}
            {tab === 'others' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="form-label">Refund</label>
                            <SearchableSelect
                                options={revenueOptions}
                                value={mappings.others?.refundAccountId ?? ''}
                                onChange={(v) => setOther('refundAccountId', v)}
                                placeholder="Select account..."
                            />
                        </div>
                        <div>
                            <label className="form-label">Seller-borne Voucher</label>
                            <SearchableSelect
                                options={expenseOptions}
                                value={mappings.others?.sellerVoucherAccountId ?? ''}
                                onChange={(v) => setOther('sellerVoucherAccountId', v)}
                                placeholder="Select expense account..."
                            />
                        </div>
                        <div>
                            <label className="form-label">Platform-borne Voucher</label>
                            <SearchableSelect
                                options={revenueOptions}
                                value={mappings.others?.platformVoucherAccountId ?? ''}
                                onChange={(v) => setOther('platformVoucherAccountId', v)}
                                placeholder="Select revenue account..."
                            />
                        </div>
                        <div>
                            <label className="form-label">Coin Cashback</label>
                            <SearchableSelect
                                options={expenseOptions}
                                value={mappings.others?.coinCashbackAccountId ?? ''}
                                onChange={(v) => setOther('coinCashbackAccountId', v)}
                                placeholder="Select expense account..."
                            />
                        </div>
                        <div>
                            <label className="form-label">Withholding Tax</label>
                            <SearchableSelect
                                options={taxOptions}
                                value={mappings.others?.withholdingTaxAccountId ?? ''}
                                onChange={(v) => setOther('withholdingTaxAccountId', v)}
                                placeholder="Select liability/expense account..."
                            />
                        </div>
                        <div>
                            <label className="form-label">Rounding</label>
                            <SearchableSelect
                                options={roundingOptions}
                                value={mappings.others?.roundingAccountId ?? ''}
                                onChange={(v) => setOther('roundingAccountId', v)}
                                placeholder="Select account..."
                            />
                        </div>
                    </div>
                    <div>
                        <label className="form-label">Notes</label>
                        <textarea
                            className="w-full min-h-[80px] px-3 py-2 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            value={mappings.others?.notes ?? ''}
                            onChange={(e) => setOther('notes', e.target.value)}
                            placeholder="Optional notes about this shop..."
                        />
                    </div>
                </div>
            )}

            <div className="integrations-modal-actions mt-6 pt-4 border-t border-neutral-200">
                <Button text="Cancel" variant="tertiary" onClick={close} />
                <Button
                    text={createConnection.isPending ? 'Saving...' : 'Save Connection'}
                    variant="primary"
                    disabled={!canCreate || createConnection.isPending}
                    onClick={handleSave}
                />
            </div>
        </Modal>
    );
};

export default ConnectShopModal;
