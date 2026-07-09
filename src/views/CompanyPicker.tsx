import React, { useState } from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import Button from '../components/UI/Button';
import { useAuthStore } from '../stores/useAuthStore';
import { getActiveOrgId, getLastOrgId } from '../lib/activeOrg';

/**
 * Post-login company picker (Accurate-style database list). Shown by
 * ProtectedRoute when the session has multiple memberships and no active org
 * has been chosen for this tab yet. Clicking a company hard-reloads through
 * the ?org= handshake so every org-scoped persisted store hydrates from the
 * chosen company's bucket.
 */
const CompanyPicker = (): React.ReactElement => {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const needsOrgSelection = useAuthStore((s) => s.needsOrgSelection);
  const selectOrg = useAuthStore((s) => s.selectOrg);
  const logout = useAuthStore((s) => s.logout);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const lastOrgId = getLastOrgId();

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

  const handleSelect = (orgId: string): void => {
    if (selectingId) return;
    setSelectingId(orgId);
    // selectOrg hard-reloads into the chosen org; the spinner stays visible
    // (and the list disabled) until navigation replaces the page.
    selectOrg(orgId);
  };

  // Once user becomes null, ProtectedRoute redirects this route to /login.
  const handleLogout = (): void => {
    void logout();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-lg sm:p-8">
        <div className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
            MSM Accounting
          </p>
          <h1 className="text-2xl font-semibold text-neutral-900">Choose a company</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {user?.fullName ? `Signed in as ${user.fullName}. ` : ''}Pick the company to work in — this tab stays pinned to it.
          </p>
        </div>

        {memberships.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No companies available for your account — contact your administrator.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memberships.map((m) => {
              const isLast = m.orgId === lastOrgId;
              return (
                <li key={m.orgId}>
                  <button
                    type="button"
                    onClick={() => handleSelect(m.orgId)}
                    disabled={selectingId !== null}
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

        {previousSelectionRejected && (
          <p className="mt-4 text-xs text-neutral-500">
            Just added to a new company? Sign out and back in to refresh your access.
          </p>
        )}

        <div className="mt-6 flex justify-end border-t border-neutral-200 pt-4">
          <Button text="Logout" size="small" variant="tertiary" onClick={handleLogout} disabled={selectingId !== null} />
        </div>
      </div>
    </div>
  );
};

export default CompanyPicker;
