import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useRegisters, useOpenShift } from '../hooks/usePos';
import { t } from '../i18n/strings';

export default function ShiftOpenView({ onOpened }: { onOpened: (shiftId: string, registerId: string) => void }): React.ReactElement {
  const registers = useRegisters();
  const openShift = useOpenShift();
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const chosen = registerId || registers.data?.[0]?.id || '';

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
        <label className="block text-sm font-medium">{t('shift.register')}</label>
        <select className="w-full rounded border p-2" value={chosen} onChange={(e) => setRegisterId(e.target.value)}>
          {(registers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <Input label={t('shift.openingFloat')} type="number" value={float} onChange={(e) => setFloat(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button variant="primary" text={t('shift.open')} loading={openShift.isPending} disabled={!chosen} onClick={open} className="w-full" />
      </div>
    </div>
  );
}
