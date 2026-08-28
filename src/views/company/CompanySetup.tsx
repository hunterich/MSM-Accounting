import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import ListPage from '../../components/Layout/ListPage';
import { formatDateID } from '../../utils/formatters';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useOrganizationSettings, useUpdateOrganizationSettings, useUpdateCostingMethod } from '../../hooks/useOrganizationSettings';
import { useRecalculateCosting, type RecalculateCostingResult } from '../../hooks/useInventory';
import { formatIDR } from '../../utils/formatters';
import AccountingPeriodsCard from '../../components/company/AccountingPeriodsCard';
import FiscalYearCloseCard from '../../components/company/FiscalYearCloseCard';

const DEFAULT_FISCAL_YEAR_START = '2026-01-01';

interface CompanyFormState {
    legalName: string;
    displayName: string;
    npwp: string;
    address: string;
    phone: string;
    email: string;
    logoUrl: string;
    isPkp: string;
    baseCurrency: string;
    fiscalYearStart: string;
    costingMethod: string;
}

interface FormErrors {
    legalName?: string | null;
    displayName?: string | null;
    email?: string | null;
    fiscalYearStart?: string | null;
    costingMethod?: string | null;
    address?: string | null;
    phone?: string | null;
    npwp?: string | null;
    logoUrl?: string | null;
}

const CompanySetup = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const onboardingMode = searchParams.get('onboarding') === 'inventory-valuation';
    const companyInfo = useSettingsStore((s) => s.companyInfo);
    const setCompanyInfo = useSettingsStore((s) => s.setCompanyInfo);
    const updateOrganizationContext = useAuthStore((s) => s.updateOrganizationContext);
    // Same gate the close/reopen routes enforce server-side (SETTINGS/edit);
    // without it the buttons would offer an action the API refuses.
    const canManagePeriods = useAuthStore((s) => s.hasPermission('settings', 'edit'));
    const { data: orgSettings, isLoading, error } = useOrganizationSettings();
    const updateOrganizationSettings = useUpdateOrganizationSettings();

    const [company, setCompany] = useState<CompanyFormState>({
        legalName: 'MSM Trading Indonesia',
        displayName: companyInfo.companyName || 'MSM Accounting',
        npwp: companyInfo.npwp || '',
        address: companyInfo.address || '',
        phone: companyInfo.phone || '',
        email: companyInfo.email || '',
        logoUrl: companyInfo.logoUrl || '',
        isPkp: 'No',
        baseCurrency: 'IDR',
        fiscalYearStart: DEFAULT_FISCAL_YEAR_START,
        costingMethod: '',
    });
    const [errors, setErrors] = useState<FormErrors>({});
    const [lastSavedAt, setLastSavedAt] = useState('');
    const [didHydrate, setDidHydrate] = useState(false);

    // Costing method change flow
    const updateCostingMethod = useUpdateCostingMethod();
    const recalculateCosting = useRecalculateCosting();
    const [changeMethodModalOpen, setChangeMethodModalOpen] = useState(false);
    const [changingToMethod, setChangingToMethod] = useState<'FIFO' | 'WEIGHTED_AVERAGE'>('FIFO');
    const [changeEffectiveDate, setChangeEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
    const [changeMethodError, setChangeMethodError] = useState('');
    const [recalcResult, setRecalcResult] = useState<RecalculateCostingResult | null>(null);
    const [recalculating, setRecalculating] = useState(false);

    useEffect(() => {
        if (!orgSettings || didHydrate) return;

        const fiscalYearStart = orgSettings.fiscalYearStart || DEFAULT_FISCAL_YEAR_START;
        setCompany((prev) => ({
            ...prev,
            legalName: orgSettings.legalName || prev.legalName,
            displayName: orgSettings.displayName || prev.displayName,
            npwp: orgSettings.npwp || prev.npwp,
            isPkp: orgSettings.isPkp ? 'Yes' : 'No',
            baseCurrency: orgSettings.baseCurrency || prev.baseCurrency,
            fiscalYearStart,
            costingMethod: (orgSettings.costingMethod as string) || '',
        }));
        setDidHydrate(true);
    }, [didHydrate, orgSettings]);

    const handleChange = (key: keyof CompanyFormState, value: string): void => {
        setCompany((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: null }));
    };

    const validate = (): FormErrors => {
        const next: FormErrors = {};
        if (!company.legalName.trim()) next.legalName = 'Legal company name is required.';
        if (!company.displayName.trim()) next.displayName = 'Display name is required.';
        if (company.email && !company.email.includes('@')) next.email = 'Email format is invalid.';
        if (!company.fiscalYearStart) next.fiscalYearStart = 'Fiscal year start is required.';
        if (!company.costingMethod) next.costingMethod = 'Choose a costing method before continuing.';
        return next;
    };

    const handleSave = async (): Promise<void> => {
        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        try {
            const updatedSettings = await updateOrganizationSettings.mutateAsync({
                legalName: company.legalName.trim(),
                displayName: company.displayName.trim(),
                npwp: company.npwp.trim(),
                isPkp: company.isPkp === 'Yes',
                baseCurrency: company.baseCurrency,
                fiscalYearStart: company.fiscalYearStart,
                costingMethod: company.costingMethod as '' | 'FIFO' | 'WEIGHTED_AVERAGE',
                costingMethodEffectiveDate: orgSettings?.costingMethodEffectiveDate || company.fiscalYearStart,
            });

            updateOrganizationContext(
                {
                    name: updatedSettings.displayName || company.displayName.trim(),
                    costingMethod: updatedSettings.costingMethod || company.costingMethod,
                    costingMethodEffectiveDate: updatedSettings.costingMethodEffectiveDate
                        ? String(updatedSettings.costingMethodEffectiveDate).slice(0, 10)
                        : (orgSettings?.costingMethodEffectiveDate || company.fiscalYearStart),
                },
                updatedSettings.needsInventoryValuationSetup === true,
            );

            setCompanyInfo({
                companyName: company.displayName.trim(),
                address: company.address.trim(),
                phone: company.phone.trim(),
                email: company.email.trim(),
                npwp: company.npwp.trim(),
                logoUrl: company.logoUrl.trim(),
            });
            setLastSavedAt(new Date().toISOString());

            if (onboardingMode && company.costingMethod) {
                const nextPath = location.state?.from?.pathname && location.state.from.pathname !== '/company-setup'
                    ? location.state.from.pathname
                    : '/';
                navigate(nextPath, { replace: true });
            }
        } catch (saveError) {
            window.alert(saveError instanceof Error ? saveError.message : 'Failed to save company settings');
        }
    };

    return (
        <ListPage
            containerClassName="company-setup"
            title="Company Setup"
            subtitle="Configure company profile, fiscal year, and inventory valuation method."
            actions={(
                <Button
                    text={updateOrganizationSettings.isPending ? 'Saving...' : 'Save Changes'}
                    variant="primary"
                    onClick={handleSave}
                    disabled={isLoading || updateOrganizationSettings.isPending}
                />
            )}
        >
            {onboardingMode && orgSettings?.needsInventoryValuationSetup ? (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Choose your company&apos;s costing method to unlock the rest of the workspace. You can change it later from company settings with a controlled switch flow.
                </div>
            ) : null}

            {error ? (
                <div className="mb-6 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                    {error instanceof Error ? error.message : 'Failed to load company settings.'}
                </div>
            ) : null}

            <div className="grid-12 section-grid">
                <div className="col-span-7">
                    <Card title="Company Profile">
                        <div className="mb-4">
                            <label className="form-label">Legal Company Name</label>
                            <Input
                                value={company.legalName}
                                onChange={(e) => handleChange('legalName', e.target.value)}
                                error={errors.legalName ?? undefined}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Display Name</label>
                            <Input
                                value={company.displayName}
                                onChange={(e) => handleChange('displayName', e.target.value)}
                                error={errors.displayName ?? undefined}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">NPWP</label>
                            <Input
                                value={company.npwp}
                                onChange={(e) => handleChange('npwp', e.target.value)}
                                error={errors.npwp ?? undefined}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Address</label>
                            <Input
                                value={company.address}
                                onChange={(e) => handleChange('address', e.target.value)}
                                placeholder="Jl. Sudirman No. 1, Jakarta"
                                error={errors.address ?? undefined}
                            />
                        </div>
                        <div className="grid-12">
                            <div className="col-span-6">
                                <label className="form-label">Phone</label>
                                <Input
                                    value={company.phone}
                                    onChange={(e) => handleChange('phone', e.target.value)}
                                    placeholder="021-1234567"
                                    error={errors.phone ?? undefined}
                                />
                            </div>
                            <div className="col-span-6">
                                <label className="form-label">Email</label>
                                <Input
                                    type="email"
                                    value={company.email}
                                    onChange={(e) => handleChange('email', e.target.value)}
                                    placeholder="finance@company.com"
                                    error={errors.email ?? undefined}
                                />
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Logo URL</label>
                            <Input
                                value={company.logoUrl}
                                onChange={(e) => handleChange('logoUrl', e.target.value)}
                                placeholder="https://..."
                                error={errors.logoUrl ?? undefined}
                            />
                        </div>
                        <div className="grid-12">
                            <div className="col-span-6">
                                <label className="form-label">PKP Status</label>
                                <select
                                    className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                    value={company.isPkp}
                                    onChange={(e) => handleChange('isPkp', e.target.value)}
                                >
                                    <option>No</option>
                                    <option>Yes</option>
                                </select>
                            </div>
                            <div className="col-span-6">
                                <label className="form-label">Base Currency</label>
                                <select
                                    className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                    value={company.baseCurrency}
                                    onChange={(e) => handleChange('baseCurrency', e.target.value)}
                                >
                                    <option>IDR</option>
                                    <option>USD</option>
                                    <option>SGD</option>
                                </select>
                            </div>
                        </div>
                    </Card>
                </div>

                <div className="col-span-5 space-y-4">
                    <Card title="Inventory Costing">
                        {/* Case 1: costing method not set — show prominent notice */}
                        {!orgSettings?.costingMethod && !company.costingMethod ? (
                            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-4 mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-amber-600 text-lg">&#9888;</span>
                                    <span className="font-semibold text-amber-900">Costing Method Not Set</span>
                                </div>
                                <p className="text-sm text-amber-800 mb-3">
                                    Choose your inventory costing method before creating bills or invoices with inventory items.
                                </p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={() => handleChange('costingMethod', 'FIFO')}
                                        className={`rounded-xl border px-4 py-4 text-left transition focus:outline-0 focus:ring-2 focus:ring-primary-200 ${company.costingMethod === 'FIFO' ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-neutral-0 hover:border-primary-300 hover:bg-primary-50/40'}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-neutral-900">FIFO — First In, First Out</span>
                                            <span className={`inline-flex h-4 w-4 rounded-full border-2 ${company.costingMethod === 'FIFO' ? 'border-primary-600 bg-primary-600 shadow-[inset_0_0_0_2px_white]' : 'border-neutral-300 bg-neutral-0'}`} />
                                        </div>
                                        <p className="mt-2 text-xs text-neutral-600">Ideal for products where you sell oldest stock first (perishables, fashion).</p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleChange('costingMethod', 'WEIGHTED_AVERAGE')}
                                        className={`rounded-xl border px-4 py-4 text-left transition focus:outline-0 focus:ring-2 focus:ring-primary-200 ${company.costingMethod === 'WEIGHTED_AVERAGE' ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-neutral-0 hover:border-primary-300 hover:bg-primary-50/40'}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-neutral-900">Weighted Average</span>
                                            <span className={`inline-flex h-4 w-4 rounded-full border-2 ${company.costingMethod === 'WEIGHTED_AVERAGE' ? 'border-primary-600 bg-primary-600 shadow-[inset_0_0_0_2px_white]' : 'border-neutral-300 bg-neutral-0'}`} />
                                        </div>
                                        <p className="mt-2 text-xs text-neutral-600">Ideal for fungible goods where cost averaging is acceptable (raw materials, commodities).</p>
                                    </button>
                                </div>
                                {errors.costingMethod ? <div className="w-full mt-2 text-xs text-danger-500">{errors.costingMethod}</div> : null}
                            </div>
                        ) : (
                            /* Case 2: method is set — show current with change button */
                            <div className="mb-4">
                                <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                                    <div>
                                        <div className="text-sm font-semibold text-neutral-900">
                                            Current: {company.costingMethod === 'FIFO' ? 'FIFO (First In, First Out)' : 'Weighted Average'}
                                        </div>
                                        {orgSettings?.costingMethodEffectiveDate && (
                                            <div className="text-xs text-neutral-500 mt-0.5">
                                                Effective {formatDateID(orgSettings.costingMethodEffectiveDate)}
                                                {orgSettings.costingMethodSetAt ? ` — last set ${formatDateID(orgSettings.costingMethodSetAt.slice(0, 10))}` : ''}
                                            </div>
                                        )}
                                    </div>
                                    <Button
                                        text="Change Method"
                                        size="small"
                                        variant="secondary"
                                        onClick={() => {
                                            setChangingToMethod(company.costingMethod === 'FIFO' ? 'WEIGHTED_AVERAGE' : 'FIFO');
                                            setChangeEffectiveDate(new Date().toISOString().slice(0, 10));
                                            setChangeMethodError('');
                                            setChangeMethodModalOpen(true);
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Always show the inline selector if not yet set, with error indicator */}
                        {!(!orgSettings?.costingMethod && !company.costingMethod) && (
                            <div className="mb-4">
                                <label className="form-label">Costing Method</label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={() => handleChange('costingMethod', 'FIFO')}
                                        aria-pressed={company.costingMethod === 'FIFO'}
                                        className={`rounded-xl border px-4 py-4 text-left transition focus:outline-0 focus:ring-2 focus:ring-primary-200 ${company.costingMethod === 'FIFO' ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-neutral-0 hover:border-primary-300 hover:bg-primary-50/40'} ${errors.costingMethod ? 'border-danger-300' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-neutral-900">FIFO</span>
                                            <span className={`inline-flex h-4 w-4 rounded-full border-2 ${company.costingMethod === 'FIFO' ? 'border-primary-600 bg-primary-600 shadow-[inset_0_0_0_2px_white]' : 'border-neutral-300 bg-neutral-0'}`} />
                                        </div>
                                        <p className="mt-2 text-sm text-neutral-600">Uses the oldest stock cost first for every inventory issue.</p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleChange('costingMethod', 'WEIGHTED_AVERAGE')}
                                        aria-pressed={company.costingMethod === 'WEIGHTED_AVERAGE'}
                                        className={`rounded-xl border px-4 py-4 text-left transition focus:outline-0 focus:ring-2 focus:ring-primary-200 ${company.costingMethod === 'WEIGHTED_AVERAGE' ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-neutral-0 hover:border-primary-300 hover:bg-primary-50/40'} ${errors.costingMethod ? 'border-danger-300' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-neutral-900">Weighted Average</span>
                                            <span className={`inline-flex h-4 w-4 rounded-full border-2 ${company.costingMethod === 'WEIGHTED_AVERAGE' ? 'border-primary-600 bg-primary-600 shadow-[inset_0_0_0_2px_white]' : 'border-neutral-300 bg-neutral-0'}`} />
                                        </div>
                                        <p className="mt-2 text-sm text-neutral-600">Keeps one rolling average cost after each stock receipt.</p>
                                    </button>
                                </div>
                                {errors.costingMethod ? <div className="w-full mt-1 text-xs text-danger-500">{errors.costingMethod}</div> : null}
                            </div>
                        )}

                        {lastSavedAt ? (
                            <div className="text-muted-sm mt-spacing-2">
                                Saved at {formatDateID(lastSavedAt.slice(0, 10))}.
                            </div>
                        ) : null}
                    </Card>

                    {/* Change costing method confirmation modal */}
                    <Modal
                        isOpen={changeMethodModalOpen}
                        onClose={() => setChangeMethodModalOpen(false)}
                        title="Change Costing Method"
                        size="sm"
                    >
                        <div className="space-y-4">
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                                <strong>Warning:</strong> Changing the costing method will trigger a recalculation of all inventory values from the effective date. This cannot be undone.
                            </div>
                            <div>
                                <label className="form-label">Change to</label>
                                <div className="flex gap-3">
                                    {(['FIFO', 'WEIGHTED_AVERAGE'] as const).map((m) => (
                                        <label key={m} className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input
                                                type="radio"
                                                name="change-method"
                                                value={m}
                                                checked={changingToMethod === m}
                                                onChange={() => setChangingToMethod(m)}
                                            />
                                            {m === 'FIFO' ? 'FIFO' : 'Weighted Average'}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="form-label">Effective Date</label>
                                <input
                                    type="date"
                                    className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                    value={changeEffectiveDate}
                                    onChange={(e) => setChangeEffectiveDate(e.target.value)}
                                />
                            </div>
                            {changeMethodError && (
                                <div className="text-xs text-danger-600">{changeMethodError}</div>
                            )}
                            <div className="flex justify-end gap-2 pt-2">
                                <Button text="Cancel" variant="secondary" onClick={() => setChangeMethodModalOpen(false)} />
                                <Button
                                    text={recalculating ? 'Recalculating...' : updateCostingMethod.isPending ? 'Saving...' : 'Confirm Change'}
                                    variant="primary"
                                    disabled={updateCostingMethod.isPending || recalculating}
                                    onClick={async () => {
                                        if (!changeEffectiveDate) { setChangeMethodError('Effective date is required.'); return; }
                                        setChangeMethodError('');
                                        setRecalculating(true);
                                        try {
                                            await updateCostingMethod.mutateAsync({
                                                costingMethod: changingToMethod,
                                                costingMethodEffectiveDate: changeEffectiveDate,
                                            });
                                            // Recalculate inventory costing
                                            try {
                                                const result = await recalculateCosting.mutateAsync({
                                                    newMethod: changingToMethod,
                                                    effectiveDate: changeEffectiveDate,
                                                });
                                                setRecalcResult(result);
                                            } catch {
                                                // Recalculation is optional; method change still succeeded
                                            }
                                            handleChange('costingMethod', changingToMethod);
                                            setChangeMethodModalOpen(false);
                                        } catch (err) {
                                            setChangeMethodError((err as Error)?.message ?? 'Failed to change costing method.');
                                        } finally {
                                            setRecalculating(false);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Modal>

                    <Card title="Fiscal Settings">
                        <div className="mb-4">
                            <label className="form-label">Fiscal Year Start</label>
                            <Input
                                type="date"
                                value={company.fiscalYearStart}
                                onChange={(e) => handleChange('fiscalYearStart', e.target.value)}
                                error={errors.fiscalYearStart ?? undefined}
                            />
                        </div>
                        <div className="text-muted-sm">
                            Monthly periods are created with the company. Close one below to lock its entries.
                        </div>
                    </Card>
                </div>
            </div>

            {!onboardingMode || !orgSettings?.needsInventoryValuationSetup ? (
                <>
                    <AccountingPeriodsCard canManage={canManagePeriods} />
                    <div className="mt-spacing-4">
                        <FiscalYearCloseCard canManage={canManagePeriods} />
                    </div>
                </>
            ) : null}

            {/* Recalculation Result Modal */}
            {recalcResult && (
                <Modal isOpen title="Costing Recalculation Complete" onClose={() => setRecalcResult(null)} size="sm">
                    <div className="p-4 space-y-3">
                        <p className="text-sm text-neutral-700">Inventory costing has been recalculated successfully.</p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="text-neutral-500">Items Recalculated</div>
                            <div className="font-medium">{recalcResult.itemsRecalculated}</div>
                            <div className="text-neutral-500">Total Value Impact</div>
                            <div className={`font-medium ${recalcResult.totalValueChange >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
                                {recalcResult.totalValueChange >= 0 ? '+' : ''}{formatIDR(recalcResult.totalValueChange)}
                            </div>
                            <div className="text-neutral-500">Journal Entry</div>
                            <div className="font-mono text-xs">{recalcResult.journalEntryId}</div>
                        </div>
                        <div className="flex justify-end pt-2">
                            <Button text="Close" variant="secondary" onClick={() => setRecalcResult(null)} />
                        </div>
                    </div>
                </Modal>
            )}
        </ListPage>
    );
};

export default CompanySetup;
