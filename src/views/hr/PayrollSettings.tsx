import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/apiClient';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import type { BPJSRules } from '../../../lib/payroll-rules';

export default function PayrollSettings() {
    const { canEdit } = useModulePermissions('settings'),
        qc = useQueryClient();
    const { data: policies = [], error } = useQuery({
        queryKey: ['payrollPolicies'],
        queryFn: () => api.get<any[]>('/api/v1/payroll-settings'),
    });
    const [from, setFrom] = useState(''),
        [until, setUntil] = useState(''),
        [holidays, setHolidays] = useState(''),
        [risk, setRisk] = useState(''),
        [shortDay, setShortDay] = useState(6);
    const [rules, setRules] = useState<BPJSRules>({
        kesehatan: {
            employee: 0.01,
            employer: 0.04,
            ceiling: 12_000_000,
            floor: 0,
        },
        jht: { employee: 0.02, employer: 0.037 },
        jp: { employee: 0.01, employer: 0.02, ceiling: 0 },
        jkk: { employer: 0.0024 },
        jkm: { employer: 0.003 },
    });
    const save = useMutation({
        mutationFn: () =>
            api.post('/api/v1/payroll-settings', {
                effectiveFrom: from,
                validUntil: until,
                rules: {
                    bpjs: { ...rules, jkk: { employer: Number(risk) } },
                    holidays: holidays.split(/\s+/).filter(Boolean),
                    shortWorkday: shortDay,
                },
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['payrollPolicies'] });
            setFrom('');
            setUntil('');
        },
    });
    const field = (
        program: keyof BPJSRules,
        key: string,
        label: string,
        percent = false,
    ) => (
        <label key={program + key} className="text-sm">
            {label}
            <input
                type="number"
                min={0}
                step="any"
                required
                aria-label={label}
                className="block w-full border rounded p-2"
                value={
                    Number((rules[program] as any)[key]) * (percent ? 100 : 1)
                }
                onChange={(e) =>
                    setRules((p) => ({
                        ...p,
                        [program]: {
                            ...p[program],
                            [key]: Number(e.target.value) / (percent ? 100 : 1),
                        },
                    }))
                }
            />
        </label>
    );
    return (
        <details className="border rounded p-3 mb-4">
            <summary className="cursor-pointer font-semibold">
                Payroll settings — effective-dated BPJS and holiday calendar
            </summary>
            {error && <p role="alert">Cannot load payroll settings.</p>}
            <p className="text-sm my-2">
                Policies are saved as dated records. Enter the JP ceiling for
                the applicable March–February cycle and select the company’s JKK
                risk rate. Configure Salary Expense 5100, PPh 21 Payable 2300,
                BPJS Payable 2310 and the default Bank / Cash Asset in Company
                Setup before posting.
            </p>
            <ul>
                {policies.map((p) => (
                    <li key={p.id}>
                        {String(p.effectiveFrom).slice(0, 10)} to{' '}
                        {String(p.validUntil).slice(0, 10)} — JP ceiling{' '}
                        {Number(p.rules.bpjs.jp.ceiling).toLocaleString(
                            'id-ID',
                        )}
                        , JKK {p.rules.bpjs.jkk.employer * 100}%
                    </li>
                ))}
            </ul>
            {canEdit && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (risk) save.mutate();
                    }}
                    className="space-y-3 mt-3"
                >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <label>
                            Effective from
                            <input
                                aria-label="Payroll policy effective from"
                                required
                                type="date"
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                                className="block border p-2"
                            />
                        </label>
                        <label>
                            Valid until
                            <input
                                aria-label="Payroll policy valid until"
                                required
                                type="date"
                                value={until}
                                onChange={(e) => setUntil(e.target.value)}
                                className="block border p-2"
                            />
                        </label>
                        {field('kesehatan', 'ceiling', 'Health wage ceiling')}
                        {field('kesehatan', 'floor', 'Health wage floor')}
                        {field(
                            'kesehatan',
                            'employee',
                            'Health employee %',
                            true,
                        )}
                        {field(
                            'kesehatan',
                            'employer',
                            'Health employer %',
                            true,
                        )}
                        {field('jht', 'employee', 'JHT employee %', true)}
                        {field('jht', 'employer', 'JHT employer %', true)}
                        {field('jp', 'ceiling', 'JP wage ceiling')}
                        {field('jp', 'employee', 'JP employee %', true)}
                        {field('jp', 'employer', 'JP employer %', true)}
                        {field('jkm', 'employer', 'JKM employer %', true)}
                        <label>
                            JKK risk rate
                            <select
                                aria-label="JKK risk rate"
                                required
                                value={risk}
                                onChange={(e) => setRisk(e.target.value)}
                                className="block border p-2"
                            >
                                <option value="">Select company risk</option>
                                {[0.0024, 0.0054, 0.0089, 0.0127, 0.0174].map(
                                    (r) => (
                                        <option key={r} value={r}>
                                            {Number((r * 100).toFixed(2))}%
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        <label>
                            6-day week shortest day
                            <select
                                aria-label="Shortest workday"
                                value={shortDay}
                                onChange={(e) =>
                                    setShortDay(Number(e.target.value))
                                }
                                className="block border p-2"
                            >
                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                                    (v, i) => (
                                        <option value={i + 1} key={v}>
                                            {v}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                    </div>
                    <label className="block">
                        Public/company holidays (YYYY-MM-DD, separated by spaces
                        or newlines)
                        <textarea
                            aria-label="Payroll holidays"
                            value={holidays}
                            onChange={(e) => setHolidays(e.target.value)}
                            className="block border rounded p-2 w-full"
                        />
                    </label>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={save.isPending}
                    >
                        Save dated payroll settings
                    </button>
                    {save.error && <p role="alert">{save.error.message}</p>}
                    {save.isSuccess && (
                        <p role="status">Payroll settings saved.</p>
                    )}
                </form>
            )}
        </details>
    );
}
