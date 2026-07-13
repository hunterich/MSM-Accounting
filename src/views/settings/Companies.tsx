import React, { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import { api } from '../../api/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { getActiveOrgId } from '../../lib/activeOrg';

interface NewCompanyForm {
    displayName: string;
    legalName: string;
    npwp: string;
    isPkp: boolean;
    fiscalYearStart: string; // YYYY-MM-DD; empty → server defaults to Jan 1 of the current year
}

const EMPTY_FORM: NewCompanyForm = {
    displayName: '',
    legalName: '',
    npwp: '',
    isPkp: false,
    fiscalYearStart: '',
};

/**
 * Settings → Companies (ADMIN only): the caller's company memberships plus a
 * "New Company" wizard. Creation bootstraps the standard template server-side
 * (COA, warehouse WH-MAIN, roles, 12 open periods) and makes the caller its
 * Admin; the session is then refreshed so the header switcher — and the "Open
 * now" toast action — can jump straight into the new company.
 */
const Companies = (): React.ReactElement => {
    const memberships = useAuthStore((s) => s.memberships);
    const pushToast = useToastStore((s) => s.pushToast);
    const activeOrgId = getActiveOrgId();

    const [form, setForm] = useState<NewCompanyForm>(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);

    const handleCreate = async (): Promise<void> => {
        const displayName = form.displayName.trim();
        const legalName = form.legalName.trim();
        if (displayName.length < 2 || legalName.length < 2) {
            pushToast('Company name and legal name must be at least 2 characters.', 'error');
            return;
        }

        setSubmitting(true);
        // Failure handling is scoped to the CREATE call only: once the company
        // exists, a refresh/session hiccup must not re-show the filled form —
        // a natural "retry" there would create a permanent duplicate.
        let orgId: string;
        try {
            ({ orgId } = await api.post<{ orgId: string }>('/api/v1/organizations', {
                legalName,
                displayName,
                ...(form.npwp.trim() ? { npwp: form.npwp.trim() } : {}),
                isPkp: form.isPkp,
                ...(form.fiscalYearStart ? { fiscalYearStart: form.fiscalYearStart } : {}),
            }));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : 'Failed to create company.', 'error');
            setSubmitting(false);
            return;
        }

        // Created — clear the form immediately, whatever happens next.
        setForm(EMPTY_FORM);
        try {
            // The creator's token predates the new membership — re-issue the
            // cookie from DB memberships, then refresh the in-memory session so
            // the switcher and this table show the new company immediately.
            await api.post('/api/v1/auth/refresh');
            await useAuthStore.getState().checkSession();
            pushToast(`Company "${displayName}" created.`, 'success', {
                label: 'Open now',
                onClick: () => window.open(`/?org=${encodeURIComponent(orgId)}`),
            });
        } catch {
            pushToast('Company created — reload to see it in the switcher.', 'success');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card title="Your Companies">
                <p className="settings-muted">
                    Companies your login can access. Each browser tab pins to one company — use the header switcher to change or open another in a new tab.
                </p>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-neutral-200">
                            <th className="py-2 pr-4 text-sm font-semibold text-neutral-700">Company</th>
                            <th className="py-2 pr-4 text-sm font-semibold text-neutral-700">Your role</th>
                            <th className="py-2 text-sm font-semibold text-neutral-700"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {memberships.map((m) => (
                            <tr key={m.orgId} className="border-b border-neutral-100 last:border-0">
                                <td className="py-2.5 pr-4">
                                    <span className="flex items-center gap-2 text-sm text-neutral-900">
                                        <Building2 size={16} className="text-neutral-400" />
                                        {m.name}
                                    </span>
                                </td>
                                <td className="py-2.5 pr-4">
                                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                                        {m.roleType}
                                    </span>
                                </td>
                                <td className="py-2.5">
                                    {m.orgId === activeOrgId && (
                                        <span className="rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700">
                                            Active in this tab
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {memberships.length === 0 && (
                            <tr>
                                <td colSpan={3} className="py-4 text-sm text-neutral-500">
                                    No companies found for your account.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </Card>

            <Card title="New Company">
                <p className="settings-muted">
                    Creates a ready-to-use company from the standard template: Indonesian chart of accounts, a main warehouse, default roles, and open accounting periods for the fiscal year. You become its administrator.
                </p>
                <div className="mb-4">
                    <label className="form-label">Company Name</label>
                    <Input
                        value={form.displayName}
                        onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                        placeholder="e.g. PT Usaha Baru"
                    />
                </div>
                <div className="mb-4">
                    <label className="form-label">Legal Name</label>
                    <Input
                        value={form.legalName}
                        onChange={(e) => setForm((prev) => ({ ...prev, legalName: e.target.value }))}
                        placeholder="e.g. PT Usaha Baru Sejahtera"
                    />
                </div>
                <div className="mb-4">
                    <label className="form-label">NPWP (optional)</label>
                    <Input
                        value={form.npwp}
                        onChange={(e) => setForm((prev) => ({ ...prev, npwp: e.target.value }))}
                        placeholder="01.234.567.8-901.000"
                    />
                </div>
                <div className="mb-4">
                    <label className="form-label settings-checkbox-label">
                        <input
                            type="checkbox"
                            checked={form.isPkp}
                            onChange={(e) => setForm((prev) => ({ ...prev, isPkp: e.target.checked }))}
                            className="settings-checkbox-input"
                        />
                        <span className="settings-label-strong">Registered as PKP (Pengusaha Kena Pajak)</span>
                    </label>
                </div>
                <div className="mb-4">
                    <label className="form-label">Fiscal Year Start (optional)</label>
                    <Input
                        type="date"
                        value={form.fiscalYearStart}
                        onChange={(e) => setForm((prev) => ({ ...prev, fiscalYearStart: e.target.value }))}
                    />
                    <div className="settings-help-text">
                        Twelve open accounting periods are created from this month. Leave blank for January of the current year.
                    </div>
                </div>
                <div className="settings-save-wrap">
                    <Button
                        text={submitting ? 'Creating…' : 'Create Company'}
                        variant="primary"
                        icon={<Plus size={16} />}
                        onClick={handleCreate}
                        disabled={submitting}
                        loading={submitting}
                    />
                </div>
            </Card>
        </div>
    );
};

export default Companies;
