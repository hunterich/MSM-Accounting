import React, { useEffect, useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useRegisters, useOpenShift, useOpenShifts, type PosRegister } from '../hooks/usePos';
import { useOfflineSync, uuid } from '../hooks/useOfflinePos';
import { db } from '../offline/db';
import { t } from '../i18n/strings';

export default function ShiftOpenView({ onOpened }: { onOpened: (shiftId: string, registerId: string) => void }): React.ReactElement {
  const registers = useRegisters();
  const openShifts = useOpenShifts();
  const openShift = useOpenShift();
  const { online, enqueueOp } = useOfflineSync();
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [cachedRegs, setCachedRegs] = useState<PosRegister[]>([]);

  useEffect(() => { void db.registers.get('current').then((r) => setCachedRegs(r?.rows ?? [])); }, []);

  const regList = registers.data ?? cachedRegs;
  const chosen = registerId || regList[0]?.id || '';
  const existing = (openShifts.data ?? []).find((s) => s.registerId === chosen);

  // Open the shift offline: queue the shift-open op, persist local shift state, and resume into checkout.
  async function openOffline() {
    const clientShiftId = uuid();
    const openingFloat = Number(float);
    await enqueueOp({
      localId: uuid(),
      type: 'shift-open',
      clientShiftId,
      createdAt: Date.now(),
      payload: { clientShiftId, registerId: chosen, openingFloat },
    });
    await db.shiftState.put({ key: 'current', clientShiftId, registerId: chosen, openingFloat, status: 'OPEN' });
    onOpened(clientShiftId, chosen);
  }

  async function open() {
    setError(null);
    const openingFloat = Number(float);
    // Offline up-front: skip the network and queue the open.
    if (!online) { await openOffline(); return; }
    try {
      const res = await openShift.mutateAsync({ registerId: chosen, openingFloat });
      // Persist so a reload resumes the shift; the server id doubles as the shiftState key for online shifts.
      await db.shiftState.put({ key: 'current', clientShiftId: res.id, serverShiftId: res.id, registerId: chosen, openingFloat, status: 'OPEN' });
      onOpened(res.id, chosen);
    } catch (err) {
      // Network error (no HTTP status) → the server is unreachable, fall back to the offline open.
      if ((err as { status?: number }).status === undefined) { await openOffline(); return; }
      setError((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-96 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('shift.open')}</h1>
        <div>
          <label className="mb-1 block text-sm font-medium">{t('shift.register')}</label>
          <select className="w-full rounded border p-2" value={chosen} onChange={(e) => setRegisterId(e.target.value)}>
            {regList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
