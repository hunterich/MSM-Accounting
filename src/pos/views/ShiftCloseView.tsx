import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useCloseShift, type CloseShiftResult } from '../hooks/usePos';
import { useOfflineSync, uuid } from '../hooks/useOfflinePos';
import { db, type SalePayload } from '../offline/db';
import { computeSaleTotals } from '@/lib/pos/pricing';
import { t } from '../i18n/strings';

/** Build a local Z-report from the queued sale ops for this shift (used when closing offline). */
async function localZReport(clientShiftId: string): Promise<{ totalSales: number; saleCount: number; cashCollected: number }> {
  const ops = await db.outbox.where('clientShiftId').equals(clientShiftId).toArray();
  const sales = ops.filter((o) => o.type === 'sale').map((o) => o.payload as SalePayload);
  let totalSales = 0;
  let cashCollected = 0;
  for (const s of sales) {
    totalSales += computeSaleTotals(s.lines, 11).totalAmount;
    cashCollected += s.tenders.reduce((sum, tn) => sum + tn.amount, 0);
  }
  return { totalSales, saleCount: sales.length, cashCollected };
}

export default function ShiftCloseView({ shiftId, onClosed, onCancel }: { shiftId: string; onClosed: () => void; onCancel: () => void }): React.ReactElement {
  const closeShift = useCloseShift();
  const { online, enqueueOp } = useOfflineSync();
  const [counted, setCounted] = useState('0');
  const [result, setResult] = useState<CloseShiftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Close the shift offline: queue the close op with a local Z-report to display, then clear local shift state.
  async function closeOffline(countedCash: number) {
    const current = await db.shiftState.get('current');
    const clientShiftId = current?.clientShiftId ?? shiftId;
    const serverShiftId = current?.serverShiftId; // undefined for offline-opened shifts; the sync engine fills it in
    const zReport = await localZReport(clientShiftId);
    await enqueueOp({
      localId: uuid(),
      type: 'shift-close',
      clientShiftId,
      createdAt: Date.now(),
      payload: { clientShiftId, shiftId: serverShiftId, countedCash },
    });
    await db.shiftState.delete('current');
    setResult({ status: 'CLOSED', expectedCash: zReport.cashCollected, cashVariance: countedCash - zReport.cashCollected, zReport });
  }

  async function close() {
    setError(null);
    const countedCash = Number(counted);
    // Offline up-front: skip the network and queue the close.
    if (!online) { await closeOffline(countedCash); return; }
    try {
      setResult(await closeShift.mutateAsync({ shiftId, countedCash }));
      await db.shiftState.delete('current');
    } catch (err) {
      // Network error (no HTTP status) → the server is unreachable, fall back to the offline close.
      if ((err as { status?: number }).status === undefined) { await closeOffline(countedCash); return; }
      setError((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-96 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('shift.close')}</h1>
        {!result ? (
          <>
            <Input label={t('shift.countedCash')} type="number" value={counted} onChange={(e) => setCounted(e.target.value)} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" text={t('common.cancel')} onClick={onCancel} className="flex-1" />
              <Button variant="primary" text={t('shift.close')} loading={closeShift.isPending} onClick={close} className="flex-1" />
            </div>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>{t('shift.expected')}</span><span>{result.expectedCash.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between"><span>{t('shift.variance')}</span><span>{result.cashVariance.toLocaleString('id-ID')}</span></div>
            <div className="mt-2 border-t pt-2 font-medium">{t('shift.zreport')}</div>
            <div className="flex justify-between"><span>Total</span><span>{result.zReport.totalSales.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between"><span>Sales</span><span>{result.zReport.saleCount}</span></div>
            <Button variant="primary" text="OK" onClick={onClosed} className="mt-2 w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
