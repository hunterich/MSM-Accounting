import React from 'react';
import Button from '@/src/components/UI/Button';
import { t } from '../i18n/strings';

export default function OfflineBar({ online, pendingCount, exceptionCount, onSync }: { online: boolean; pendingCount: number; exceptionCount: number; onSync: () => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${online ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-amber-500'}`} />
        {online ? t('offline.online') : t('offline.offline')}
      </span>
      {pendingCount > 0 && <span className="text-gray-500">{pendingCount} {t('offline.queued')}</span>}
      {exceptionCount > 0 && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">{exceptionCount} {t('offline.exceptions')}</span>}
      <Button variant="ghost" size="sm" text={t('offline.sync')} disabled={!online || pendingCount === 0} onClick={onSync} />
    </div>
  );
}
