import React, { useState } from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { getLastOrgId } from '../lib/activeOrg';

/**
 * Post-login company picker (Accurate-style database list). Shown by
 * ProtectedRoute when the session has multiple memberships and no active org
 * has been chosen for this tab yet. Clicking a company pins it to this tab
 * (sessionStorage) and re-runs the session check against that org.
 */
const CompanyPicker = (): React.ReactElement => {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const selectOrg = useAuthStore((s) => s.selectOrg);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const lastOrgId = getLastOrgId();

  const handleSelect = async (orgId: string): Promise<void> => {
    if (selectingId) return;
    setSelectingId(orgId);
    try {
      await selectOrg(orgId);
    } finally {
      setSelectingId(null);
    }
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
      </div>
    </div>
  );
};

export default CompanyPicker;
