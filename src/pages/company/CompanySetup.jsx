import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Table from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import ListPage from '../../components/Layout/ListPage';
import { formatDateID } from '../../utils/formatters';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useOrganizationSettings, useUpdateOrganizationSettings } from '../../hooks/useOrganizationSettings';

const DEFAULT_FISCAL_YEAR_START = '2026-01-01';

const buildPeriods = (fiscalYearStart) => {
    const start = new Date(fiscalYearStart);
    if (Number.isNaN(start.getTime())) return [];
    const today = new Date();
    const periods = [];

    for (let i = 0; i < 12; i += 1) {
        const periodStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const periodEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
        const periodName = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const status = periodEnd < currentMonthStart ? 'Closed' : 'Open';

        periods.push({
            name: periodName,
            start: periodStart.toISOString().slice(0, 10),
            end: periodEnd.toISOString().slice(0, 10),
            status,
        });
    }

    return periods;
};

const CompanySetup = () => {
    const [searchParams] = useSearchParams();
    const onboardingMode = searchParams.get('onboarding') === 'inventory-valuation';
    const companyInfo = useSettingsStore((s) => s.companyInfo);
    const setCompanyInfo = useSettingsStore((s) => s.setCompanyInfo);
    const { data: orgSettings, isLoading, error } = useOrganizationSettings();
    const updateOrganizationSettings = useUpdateOrganizationSettings();

    const [company, setCompany] = useState({
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
    const [errors, setErrors] = useState({});
    const [lastSavedAt, setLastSavedAt] = useState('');
    const [periods, setPeriods] = useState(() => buildPeriods(DEFAULT_FISCAL_YEAR_START));
    const [didHydrate, setDidHydrate] = useState(false);

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
            costingMethod: orgSettings.costingMethod || '',
        }));
        setPeriods(buildPeriods(fiscalYearStart));
        setDidHydrate(true);
    }, [didHydrate, orgSettings]);

    const periodColumns = [
        { key: 'name', label: 'Period' },
        { key: 'start', label: 'Start Date', render: (val) => formatDateID(val) },
        { key: 'end', label: 'End Date', render: (val) => formatDateID(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val} /> },
    ];

    const handleChange = (key, value) => {
        setCompany((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: null }));
    };

    const validate = () => {
        const next = {};
        if (!company.legalName.trim()) next.legalName = 'Legal company name is required.';
        if (!company.displayName.trim()) next.displayName = 'Display name is required.';
        if (company.email && !company.email.includes('@')) next.email = 'Email format is invalid.';
        if (!company.fiscalYearStart) next.fiscalYearStart = 'Fiscal year start is required.';
        if (!company.costingMethod) next.costingMethod = 'Choose a costing method before continuing.';
        return next;
    };

    const handleSave = async () => {
        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        try {
            await updateOrganizationSettings.mutateAsync({
                legalName: company.legalName.trim(),
                displayName: company.displayName.trim(),
                npwp: company.npwp.trim(),
                isPkp: company.isPkp === 'Yes',
                baseCurrency: company.baseCurrency,
                fiscalYearStart: company.fiscalYearStart,
                costingMethod: company.costingMethod,
                costingMethodEffectiveDate: orgSettings?.costingMethodEffectiveDate || company.fiscalYearStart,
            });

            setCompanyInfo({
                companyName: company.displayName.trim(),
                address: company.address.trim(),
                phone: company.phone.trim(),
                email: company.email.trim(),
                npwp: company.npwp.trim(),
                logoUrl: company.logoUrl.trim(),
            });
            setLastSavedAt(new Date().toISOString());
        } catch (saveError) {
            window.alert(saveError instanceof Error ? saveError.message : 'Failed to save company settings');
        }
    };

    const handleRegeneratePeriods = () => {
        if (!company.fiscalYearStart) {
            setErrors((prev) => ({ ...prev, fiscalYearStart: 'Fiscal year start is required before generating periods.' }));
            return;
        }
        setPeriods(buildPeriods(company.fiscalYearStart));
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
                                error={errors.legalName}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Display Name</label>
                            <Input
                                value={company.displayName}
                                onChange={(e) => handleChange('displayName', e.target.value)}
                                error={errors.displayName}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">NPWP</label>
                            <Input
                                value={company.npwp}
                                onChange={(e) => handleChange('npwp', e.target.value)}
                                error={errors.npwp}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Address</label>
                            <Input
                                value={company.address}
                                onChange={(e) => handleChange('address', e.target.value)}
                                placeholder="Jl. Sudirman No. 1, Jakarta"
                                error={errors.address}
                            />
                        </div>
                        <div className="grid-12">
                            <div className="col-span-6">
                                <label className="form-label">Phone</label>
                                <Input
                                    value={company.phone}
                                    onChange={(e) => handleChange('phone', e.target.value)}
                                    placeholder="021-1234567"
                                    error={errors.phone}
                                />
                            </div>
                            <div className="col-span-6">
                                <label className="form-label">Email</label>
                                <Input
                                    type="email"
                                    value={company.email}
                                    onChange={(e) => handleChange('email', e.target.value)}
                                    placeholder="finance@company.com"
                                    error={errors.email}
                                />
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Logo URL</label>
                            <Input
                                value={company.logoUrl}
                                onChange={(e) => handleChange('logoUrl', e.target.value)}
                                placeholder="https://..."
                                error={errors.logoUrl}
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

                <div className="col-span-5">
                    <Card title="Fiscal Settings">
                        <div className="mb-4">
                            <label className="form-label">Fiscal Year Start</label>
                            <Input
                                type="date"
                                value={company.fiscalYearStart}
                                onChange={(e) => handleChange('fiscalYearStart', e.target.value)}
                                error={errors.fiscalYearStart}
                            />
                        </div>
                        <div className="text-muted-sm">
                            Periods will be generated monthly. Closed periods are locked to prevent changes.
                        </div>
                        <div className="mt-spacing-4">
                            <Button text="Regenerate Periods" variant="secondary" size="small" onClick={handleRegeneratePeriods} />
                        </div>
                    </Card>

                    <Card title="Inventory Valuation">
                        <div className="mb-4">
                            <label className="form-label">Costing Method</label>
                            <select
                                className={`w-full h-10 px-3 rounded-md border bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 ${errors.costingMethod ? 'border-danger-500' : 'border-neutral-300'}`}
                                value={company.costingMethod}
                                onChange={(e) => handleChange('costingMethod', e.target.value)}
                            >
                                <option value="">Select a costing method</option>
                                <option value="FIFO">FIFO</option>
                                <option value="WEIGHTED_AVERAGE">Weighted Average</option>
                            </select>
                            {errors.costingMethod ? <div className="w-full mt-1 text-xs text-danger-500">{errors.costingMethod}</div> : null}
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700">
                            <p className="font-medium text-neutral-900">How this is used</p>
                            <p className="mt-2">FIFO uses the oldest stock cost first. Weighted Average keeps one rolling average cost after each receipt.</p>
                        </div>

                        <div className="mt-4 text-muted-sm">
                            Effective date: {orgSettings?.costingMethodEffectiveDate ? formatDateID(orgSettings.costingMethodEffectiveDate) : formatDateID(company.fiscalYearStart)}
                        </div>
                        {orgSettings?.costingMethodSetAt ? (
                            <div className="text-muted-sm mt-spacing-2">
                                Last set on {formatDateID(orgSettings.costingMethodSetAt.slice(0, 10))}.
                            </div>
                        ) : null}
                        {lastSavedAt ? (
                            <div className="text-muted-sm mt-spacing-2">
                                Saved at {formatDateID(lastSavedAt.slice(0, 10))}.
                            </div>
                        ) : null}
                    </Card>
                </div>
            </div>

            <Card title="Accounting Periods" padding={false}>
                <Table columns={periodColumns} data={periods} />
            </Card>
        </ListPage>
    );
};

export default CompanySetup;
