import React, { useState } from 'react';
import { Building2, ChevronRight, Plus } from 'lucide-react';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { api } from '../api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import { getActiveOrgId, getLastOrgId } from '../lib/activeOrg';
import { canCreateCompany } from '../lib/companyPicker';

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
 * Post-login company picker (Accurate-style database list). Shown by
 * ProtectedRoute whenever this tab has no company pinned yet — which is every
 * fresh sign-in, single-company accounts included. Clicking a company
 * hard-reloads through the ?org= handshake so every org-scoped persisted store
 * hydrates from the chosen company's bucket.
 *
 * The picker is also the ONLY place a company gets created or switched. That
 * used to be duplicated in Settings, which was the wrong home for it twice
 * over: Settings is scoped to the company you are already inside, and it lives
 * behind an active org, so a first-time account with no company could never
 * reach it. Creation bootstraps the standard template server-side (COA,
 * warehouse, roles, open periods) and makes the caller its Admin.
 */
const CompanyPicker = (): React.ReactElement => {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const needsOrgSelection = useAuthStore((s) => s.needsOrgSelection);
  const selectOrg = useAuthStore((s) => s.selectOrg);
  const logout = useAuthStore((s) => s.logout);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const lastOrgId = getLastOrgId();

  const isFirstCompany = memberships.length === 0;
  const [creating, setCreating] = useState<boolean>(isFirstCompany);
  const [form, setForm] = useState<NewCompanyForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string>('');

  // Bounce case: this tab still carries an org pin, yet /auth/me could not
  // resolve it — the selection was rejected. The ?org= handshake pins the tab
  // BEFORE checkSession, and nothing clears the pin when /me bounces
  // (apiClient clears only on data-route 403s, and no data route mounts
  // behind the picker gate), so "pin present AND needsOrgSelection" detects
  // the rejection directly. Note the JWT/DB split: resolution validates
  // against JWT claims while this list is DB-derived, so a just-granted
  // membership can appear below yet still bounce until re-login. Fresh
  // logins stay silent (logout clears the pin; new tabs have none).
  const previousSelectionRejected = needsOrgSelection && getActiveOrgId() !== null;

  const busy = selectingId !== null || submitting;

  const handleSelect = (orgId: string): void => {
    if (busy) return;
    setSelectingId(orgId);
    // selectOrg hard-reloads into the chosen org; the spinner stays visible
    // (and the list disabled) until navigation replaces the page.
    selectOrg(orgId);
  };

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;

    const displayName = form.displayName.trim();
    const legalName = form.legalName.trim();
    if (displayName.length < 2 || legalName.length < 2) {
      setCreateError('Company name and legal name must be at least 2 characters.');
      return;
    }

    setCreateError('');
    setSubmitting(true);

    // Failure handling is scoped to the CREATE call only: once the company
    // exists, a refresh hiccup must not re-show the filled form — a natural
    // "retry" there would create a permanent duplicate.
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
      setCreateError(e instanceof Error ? e.message : 'Failed to create company.');
      setSubmitting(false);
      return;
    }

    setForm(EMPTY_FORM);
    try {
      // The creator's token predates the new membership — re-issue the cookie
      // from DB memberships before entering, or the ?org= handshake would be
      // rejected by resolveActiveOrg (it validates against JWT claims).
      await api.post('/api/v1/auth/refresh');
    } catch {
      setCreateError('Company created, but the session could not be refreshed. Sign out and back in to open it.');
      setSubmitting(false);
      return;
    }
    // Straight into the new company — the same hard reload as picking one.
    selectOrg(orgId);
  };

  // Once user becomes null, ProtectedRoute redirects this route to /login.
  const handleLogout = (): void => {
    void logout();
  };

  const setField = <K extends keyof NewCompanyForm>(key: K, value: NewCompanyForm[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div
        data-testid="company-picker"
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-lg sm:p-8"
      >
        <div className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
            MSM Accounting
          </p>
          <h1 className="text-2xl font-semibold text-neutral-900">
            {isFirstCompany ? 'Create your company' : 'Choose a company'}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {user?.fullName ? `Signed in as ${user.fullName}. ` : ''}
            {isFirstCompany
              ? 'You have no company yet — set one up to start working.'
              : 'Pick the company to work in — this tab stays pinned to it.'}
          </p>
        </div>

        {memberships.length > 0 && (
          <ul className="flex flex-col gap-2">
            {memberships.map((m) => {
              const isLast = m.orgId === lastOrgId;
              return (
                <li key={m.orgId}>
                  <button
                    type="button"
                    data-testid="company-picker-option"
                    onClick={() => handleSelect(m.orgId)}
                    disabled={busy}
                    autoFocus={isLast}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60 ${
                      isLast
                        ? 'border-primary-300 bg-primary-50 hover:bg-primary-100'
                        : 'border-neutral-200 bg-neutral-0 hover:bg-neutral-50'
                    }`}
                  >
                    <Building2 size={20} className={isLast ? 'text-primary-700' : 'text-neutral-400'} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-neutral-900">{m.name}</span>
                      {isLast && <span className="text-xs text-primary-700">Last used</span>}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                      {m.roleType}
                    </span>
                    {selectingId === m.orgId ? (
                      <span
                        aria-hidden
                        className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin text-primary-700"
                      />
                    ) : (
                      <ChevronRight size={16} className="text-neutral-400" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {memberships.length === 0 && !canCreateCompany(memberships) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No companies available for your account — contact your administrator.
          </p>
        )}

        {canCreateCompany(memberships) && (
          <div className={memberships.length > 0 ? 'mt-4 border-t border-neutral-200 pt-4' : ''}>
            {!creating ? (
              <button
                type="button"
                data-testid="company-picker-new"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-left text-sm font-medium text-neutral-700 transition-colors duration-150 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus size={18} className="text-neutral-400" />
                New company
              </button>
            ) : (
              <form onSubmit={handleCreate} noValidate>
                <p className="mb-4 text-xs leading-5 text-neutral-500">
                  Creates a ready-to-use company from the standard template: Indonesian chart of accounts, a main
                  warehouse, default roles, and open accounting periods. You become its administrator.
                </p>

                <Input
                  id="new-company-display-name"
                  label="Company name"
                  placeholder="e.g. Cultusia"
                  value={form.displayName}
                  onChange={(e) => setField('displayName', e.target.value)}
                  required
                />
                <Input
                  id="new-company-legal-name"
                  label="Legal name"
                  placeholder="e.g. PT Murni Sukses Mandiri"
                  value={form.legalName}
                  onChange={(e) => setField('legalName', e.target.value)}
                  required
                />
                <Input
                  id="new-company-npwp"
                  label="NPWP (optional)"
                  placeholder="00.000.000.0-000.000"
                  value={form.npwp}
                  onChange={(e) => setField('npwp', e.target.value)}
                />
                <Input
                  id="new-company-fiscal-year-start"
                  label="Fiscal year start (optional)"
                  type="date"
                  value={form.fiscalYearStart}
                  onChange={(e) => setField('fiscalYearStart', e.target.value)}
                />

                <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={form.isPkp}
                    onChange={(e) => setField('isPkp', e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  Registered for VAT (PKP)
                </label>

                {createError && (
                  <div className="mb-4 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
                    {createError}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1 rounded-lg"
                    disabled={busy}
                    text={submitting ? 'Creating...' : 'Create and open'}
                  />
                  {memberships.length > 0 && (
                    <Button
                      type="button"
                      variant="tertiary"
                      size="small"
                      text="Cancel"
                      disabled={busy}
                      onClick={() => {
                        setCreating(false);
                        setCreateError('');
                      }}
                    />
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {previousSelectionRejected && memberships.length > 0 && (
          <p className="mt-4 text-xs text-neutral-500">
            Just added to a new company? Sign out and back in to refresh your access.
          </p>
        )}

        <div className="mt-6 flex justify-end border-t border-neutral-200 pt-4">
          <Button text="Logout" size="small" variant="tertiary" onClick={handleLogout} disabled={busy} />
        </div>
      </div>
    </div>
  );
};

export default CompanyPicker;
