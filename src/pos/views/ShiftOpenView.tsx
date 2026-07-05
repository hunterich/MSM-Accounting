import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useRegisters, useOpenShift, useOpenShifts } from '../hooks/usePos';
import { t } from '../i18n/strings';

export default function ShiftOpenView({ onOpened }: { onOpened: (shiftId: string, registerId: string) => void }): React.ReactElement {
  const registers = useRegisters();
  const openShifts = useOpenShifts();
  const openShift = useOpenShift();
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const chosen = registerId || registers.data?.[0]?.id || '';
  const existing = (openShifts.data ?? []).find((s) => s.registerId === chosen);

  async function open() {
    setError(null);
    try {
      const res = await openShift.mutateAsync({ registerId: chosen, openingFloat: Number(float) });
      onOpened(res.id, chosen);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-96 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('shift.open')}</h1>
        <div>
          <label className="mb-1 block text-sm font-medium">{t('shift.register')}</label>
          <select className="w-full rounded border p-2" value={chosen} onChange={(e) => setRegisterId(e.target.value)}>
            {(registers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        {existing ? (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('shift.alreadyOpen')} · {new Date(existing.openedAt).toLocaleTimeString('id-ID')}
            </p>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button variant="primary" text={t('shift.continue')} disabled={!chosen} onClick={() => onOpened(existing.id, chosen)} className="w-full" />
          </>
        ) : (
          <>
            <Input label={t('shift.openingFloat')} type="number" value={float} onChange={(e) => setFloat(e.target.value)} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button variant="primary" text={t('shift.open')} loading={openShift.isPending} disabled={!chosen || openShifts.isLoading} onClick={open} className="w-full" />
          </>
        )}
      </div>
    </div>
  );
}
