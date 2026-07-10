import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { api } from '@/src/api/apiClient';
import { getActiveOrgId, setActiveOrgId } from '@/src/lib/activeOrg';
import { resolvePosGate } from './posGate';
import { db } from './offline/db';
import { runLegacyMigrationOnce } from './offline/legacyMigration';
import { cacheCatalog } from './hooks/useOfflinePos';
import type { CatalogRow, PosRegister } from './hooks/usePos';
import LoginView from './views/LoginView';
import CompanyPickerView from './views/CompanyPickerView';
import ShiftOpenView from './views/ShiftOpenView';
import ShiftCloseView from './views/ShiftCloseView';
import CheckoutView from './views/CheckoutView';

type Screen = { name: 'checkout' } | { name: 'closing' };

const Splash = (): React.ReactElement => (
  <div className="min-h-screen flex items-center justify-center">…</div>
);

export default function PosApp(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const org = useAuthStore((s) => s.org);
  const memberships = useAuthStore((s) => s.memberships);
  const needsOrgSelection = useAuthStore((s) => s.needsOrgSelection);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => { void checkSession(); }, [checkSession]);

  if (isLoading) return <Splash />;
  if (!user) return <LoginView />;

  // Decide the gate BEFORE mounting anything that touches the org-scoped DB.
  const gate = resolvePosGate({
    activeOrgId: getActiveOrgId(),
    orgId: org?.id ?? null,
    membershipCount: memberships.length,
    needsOrgSelection,
  });

  // >1 company (or a rejected selection) → let the user choose. Never auto-pick.
  if (gate.kind === 'picker') return <CompanyPickerView />;

  // Single-company users have a server-defaulted org but NO pin (there is no
  // ?org= handshake and no picker to write it). Unlike the main SPA — which
  // silently falls back to a ':default' storage bucket — POS has no shared-DB
  // fallback by design, so without a pin getPosDb()/migration would throw and
  // blank the till. Pin the sole company synchronously here, BEFORE PosShell
  // mounts and before any db.* access. Pinning the ONLY choice is not
  // auto-picking among several.
  if (gate.kind === 'pin') setActiveOrgId(gate.orgId);

  // No pin and no resolved org yet: hold rather than open a DB with no company.
  if (gate.kind === 'wait') return <Splash />;

  // Org is resolved and pinned: mount the DB-touching shell, keyed so it fully
  // remounts if the active org ever changes within this document.
  return <PosShell key={getActiveOrgId()} membershipCount={memberships.length} />;
}

/**
 * The part of POS that touches the org-scoped offline database. Only mounts once
 * a company is resolved, and runs the one-time legacy-DB migration before it
 * reads or writes anything.
 */
function PosShell({ membershipCount }: { membershipCount: number }): React.ReactElement {
  const [migrated, setMigrated] = useState(false);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [shift, setShift] = useState<{ shiftId: string; registerId: string } | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'checkout' });
  const [resuming, setResuming] = useState(true);

  // One-time migration off the legacy shared DB, before any db write below. A
  // migration failure must NEVER blank the till: we always flip `migrated` so
  // POS opens, and surface the warning banner (legacy data may be un-rescued).
  useEffect(() => {
    let cancelled = false;
    void runLegacyMigrationOnce(membershipCount)
      .then((r) => { if (!cancelled) setLegacyWarning(r.strandedLegacy); })
      .catch((e) => {
        console.warn('[POS] legacy migration failed; opening POS anyway', e);
        if (!cancelled) setLegacyWarning(true);
      })
      .finally(() => { if (!cancelled) setMigrated(true); });
    return () => { cancelled = true; };
  }, [membershipCount]);

  // When online, warm the offline caches so the register list + product grid
  // still work if the connection drops. Gated on migration so we never write to
  // a DB before adoption has had its chance to seed it.
  useEffect(() => {
    if (!migrated) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void api.get<CatalogRow[]>('/api/v1/pos/catalog').then(cacheCatalog).catch(() => {});
    void api.get<PosRegister[]>('/api/v1/pos/registers')
      .then((rows) => db.registers.put({ key: 'current', rows, fetchedAt: Date.now() }))
      .catch(() => {});
  }, [migrated]);

  // Resume a persisted open shift so a reload lands back in checkout. Always
  // clear `resuming` (even on read failure) so the till still opens.
  useEffect(() => {
    if (!migrated) return;
    void db.shiftState.get('current')
      .then((s) => { if (s && s.status === 'OPEN') setShift({ shiftId: s.clientShiftId, registerId: s.registerId }); })
      .catch((e) => { console.warn('[POS] failed to resume shift', e); })
      .finally(() => setResuming(false));
  }, [migrated]);

  if (!migrated || resuming) return <Splash />;

  const banner = legacyWarning ? (
    <div role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      Un-migrated offline sales from a previous version were found and left untouched — they could not be
      matched to this company. Contact your administrator before clearing browser data.
    </div>
  ) : null;

  let body: React.ReactElement;
  if (!shift) {
    body = <ShiftOpenView onOpened={(shiftId, registerId) => setShift({ shiftId, registerId })} />;
  } else if (screen.name === 'closing') {
    body = <ShiftCloseView shiftId={shift.shiftId} onClosed={() => { setShift(null); setScreen({ name: 'checkout' }); }} onCancel={() => setScreen({ name: 'checkout' })} />;
  } else {
    body = <CheckoutView shiftId={shift.shiftId} registerId={shift.registerId} onCloseShift={() => setScreen({ name: 'closing' })} />;
  }

  return <>{banner}{body}</>;
}
