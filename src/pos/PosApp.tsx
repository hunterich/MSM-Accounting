import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { api } from '@/src/api/apiClient';
import { db } from './offline/db';
import { cacheCatalog } from './hooks/useOfflinePos';
import type { CatalogRow, PosRegister } from './hooks/usePos';
import LoginView from './views/LoginView';
import ShiftOpenView from './views/ShiftOpenView';
import ShiftCloseView from './views/ShiftCloseView';
import CheckoutView from './views/CheckoutView';

type Screen = { name: 'checkout' } | { name: 'closing' };

export default function PosApp(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const checkSession = useAuthStore((s) => s.checkSession);
  const [shift, setShift] = useState<{ shiftId: string; registerId: string } | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'checkout' });
  const [resuming, setResuming] = useState(true);

  useEffect(() => { void checkSession(); }, [checkSession]);

  // When logged in and online, warm the offline caches so the register list + product
  // grid still work if the connection drops before/while a shift is open.
  useEffect(() => {
    if (!user || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    void api.get<CatalogRow[]>('/api/v1/pos/catalog').then(cacheCatalog).catch(() => {});
    void api.get<PosRegister[]>('/api/v1/pos/registers')
      .then((rows) => db.registers.put({ key: 'current', rows, fetchedAt: Date.now() }))
      .catch(() => {});
  }, [user]);

  // On mount, resume a persisted open shift (online- or offline-opened) so a reload lands back in checkout.
  useEffect(() => {
    void db.shiftState.get('current').then((s) => {
      if (s && s.status === 'OPEN') setShift({ shiftId: s.clientShiftId, registerId: s.registerId });
      setResuming(false);
    });
  }, []);

  if (isLoading || resuming) return <div className="min-h-screen flex items-center justify-center">…</div>;
  if (!user) return <LoginView />;
  if (!shift) return <ShiftOpenView onOpened={(shiftId, registerId) => setShift({ shiftId, registerId })} />;
  if (screen.name === 'closing') {
    return <ShiftCloseView shiftId={shift.shiftId} onClosed={() => { setShift(null); setScreen({ name: 'checkout' }); }} onCancel={() => setScreen({ name: 'checkout' })} />;
  }
  return <CheckoutView shiftId={shift.shiftId} registerId={shift.registerId} onCloseShift={() => setScreen({ name: 'closing' })} />;
}
