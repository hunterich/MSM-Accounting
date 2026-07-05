import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { db } from './offline/db';
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
