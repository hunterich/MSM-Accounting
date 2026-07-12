import React, { useState } from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { getActiveOrgId, getLastOrgId } from '@/src/lib/activeOrg';
import { t } from '../i18n/strings';

/**
 * POS company picker. The main-app CompanyPicker cannot be reused here because
 * its selectOrg (store) hard-navigates to the accounting SPA at `/`; in POS we
 * must reload the POS document instead. Selecting a company reloads
 * `/pos.html?org=<id>` so activeOrg pins the tab and every per-company store —
 * including the org-scoped offline database — hydrates from the right bucket.
 * We NEVER auto-pick a company.
 */
export default function CompanyPickerView(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const needsOrgSelection = useAuthStore((s) => s.needsOrgSelection);
  const logout = useAuthStore((s) => s.logout);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const lastOrgId = getLastOrgId();

  // Pin present yet /auth/me could not resolve it → the previous selection was
  // rejected (e.g. membership granted but not yet in the JWT). Mirrors the
  // main-app picker's bounce detection.
  const previousSelectionRejected = needsOrgSelection && getActiveOrgId() !== null;

  const handleSelect = (orgId: string): void => {
    if (selectingId) return;
    setSelectingId(orgId);
    // Reload the POS document through the ?org= handshake (stay in POS).
    window.location.assign(`/pos.html?org=${encodeURIComponent(orgId)}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
            {t('app.title')}
          </p>
          <h1 className="text-xl font-semibold text-gray-900">Choose a company</h1>
          <p className="mt-1 text-sm text-gray-500">
            {user?.fullName ? `Signed in as ${user.fullName}. ` : ''}Pick the company to work in — this device stays pinned to it.
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
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                      isLast ? 'border-teal-300 bg-teal-50 hover:bg-teal-100' : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <Building2 size={20} className={isLast ? 'text-teal-700' : 'text-gray-400'} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-gray-900">{m.name}</span>
                      {isLast && <span className="text-xs text-teal-700">Last used</span>}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      {m.roleType}
                    </span>
                    {selectingId === m.orgId ? (
                      <span
                        aria-hidden
                        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent text-teal-700"
                      />
                    ) : (
                      <ChevronRight size={16} className="text-gray-400" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {previousSelectionRejected && (
          <p className="text-xs text-gray-500">
            Just added to a new company? Sign out and back in to refresh your access.
          </p>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <Button text="Logout" size="small" variant="tertiary" onClick={() => void logout()} disabled={selectingId !== null} />
        </div>
      </div>
    </div>
  );
}
