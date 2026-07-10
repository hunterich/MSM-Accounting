import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { api } from '@/src/api/apiClient';
import { getActiveOrgId } from '@/src/lib/activeOrg';
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
  const memberships = useAuthStore((s) => s.memberships);
  const needsOrgSelection = useAuthStore((s) => s.needsOrgSelection);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => { void checkSession(); }, [checkSession]);

  if (isLoading) return <Splash />;
  if (!user) return <LoginView />;

  // Gate on company selection BEFORE mounting anything that touches the offline
  // DB. Single-membership users never hit this (the me-route defaults to their
  // sole org, so needsOrgSelection stays false and org is already pinned) — POS
  // opens straight in, exactly as before. We NEVER auto-pick a company.
  const needsPicker = needsOrgSelection || (!getActiveOrgId() && memberships.length > 1);
  if (needsPicker) return <CompanyPickerView />;

  // Org is resolved: mount the DB-touching shell, keyed so it fully remounts if
  // the active org ever changes within this document.
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

  // One-time migration off the legacy shared DB, before any db write below.
  useEffect(() => {
    let cancelled = false;
    void runLegacyMigrationOnce(membershipCount)
      .then((r) => { if (!cancelled) setLegacyWarning(r.strandedLegacy); })
      .catch((e) => { console.warn('[POS] legacy migration failed', e); })
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

  // Resume a persisted open shift so a reload lands back in checkout.
  useEffect(() => {
    if (!migrated) return;
    void db.shiftState.get('current').then((s) => {
      if (s && s.status === 'OPEN') setShift({ shiftId: s.clientShiftId, registerId: s.registerId });
      setResuming(false);
    });
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
