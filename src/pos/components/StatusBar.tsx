import React, { useEffect, useState } from 'react';
import Button from '@/src/components/UI/Button';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { useOfflineSync } from '../hooks/useOfflinePos';
import OfflineBar from './OfflineBar';
import { t } from '../i18n/strings';

export default function StatusBar({ registerName, onLogout, onCloseShift }: { registerName: string; onLogout: () => void; onCloseShift: () => void }): React.ReactElement {
  const { online, pendingCount, exceptionCount, sync } = useOfflineSync();
  const org = useAuthStore((s) => s.org) as { name?: string; legalName?: string; displayName?: string } | null;
  const user = useAuthStore((s) => s.user);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const storeName = org?.displayName ?? org?.legalName ?? org?.name ?? 'Apotek';
  const cashier = user?.fullName ?? user?.email ?? '';

  return (
    <header className="flex items-center justify-between border-b bg-white px-4 py-2">
      <div className="flex items-center gap-4 min-w-0">
        <span className="truncate text-base font-semibold text-gray-800">{storeName}</span>
        <span className="hidden truncate text-sm text-gray-500 sm:inline">{registerName}</span>
        <span className="hidden truncate text-sm text-gray-500 md:inline">{cashier}</span>
      </div>
      <div className="flex items-center gap-3">
        <OfflineBar online={online} pendingCount={pendingCount} exceptionCount={exceptionCount} onSync={() => void sync()} />
        <span className="tabular-nums text-sm font-medium text-gray-700">{now.toLocaleTimeString('id-ID')}</span>
        <Button variant="secondary" size="sm" text={t('shift.close')} onClick={onCloseShift} />
        <Button variant="ghost" size="sm" text={t('auth.logout')} onClick={onLogout} />
      </div>
    </header>
  );
}
