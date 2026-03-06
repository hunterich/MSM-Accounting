import React, { useState } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Table from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import ListPage from '../../components/Layout/ListPage';
import { formatDateID } from '../../utils/formatters';
import { useSettingsStore } from '../../stores/useSettingsStore';

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
            status
        });
    }

    return periods;
};

const CompanySetup = () => {
    const companyInfo = useSettingsStore((s) => s.companyInfo);
    const setCompanyInfo = useSettingsStore((s) => s.setCompanyInfo);

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
        fiscalYearStart: '2026-01-01'
    });
    const [errors, setErrors] = useState({});
    const [lastSavedAt, setLastSavedAt] = useState('');

    const [periods, setPeriods] = useState(() => buildPeriods('2026-01-01'));

    const periodColumns = [
        { key: 'name', label: 'Period' },
        { key: 'start', label: 'Start Date', render: (val) => formatDateID(val) },
        { key: 'end', label: 'End Date', render: (val) => formatDateID(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val} /> }
    ];

    const handleChange = (key, value) => {
        setCompany((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: null }));
    };

    const validate = () => {
        const next = {};
        if (!company.legalName.trim()) next.legalName = 'Legal company name is required.';
        if (!company.displayName.trim()) next.displayName = 'Display name is required.';
        if (!company.npwp.trim()) next.npwp = 'NPWP is required.';
        if (company.email && !company.email.includes('@')) next.email = 'Email format is invalid.';
        if (!company.fiscalYearStart) next.fiscalYearStart = 'Fiscal year start is required.';
        return next;
    };

    const handleSave = () => {
        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        setCompanyInfo({
            companyName: company.displayName.trim(),
            address: company.address.trim(),
            phone: company.phone.trim(),
            email: company.email.trim(),
            npwp: company.npwp.trim(),
            logoUrl: company.logoUrl.trim(),
        });

        setLastSavedAt(new Date().toISOString());
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
            subtitle="Configure company profile, fiscal year, and accounting periods."
            actions={<Button text="Save Changes" variant="primary" onClick={handleSave} />}
        >

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
                        {lastSavedAt ? <div className="text-muted-sm mt-spacing-2">Saved locally at {formatDateID(lastSavedAt.slice(0, 10))}.</div> : null}
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
