import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useCloseShift, type CloseShiftResult } from '../hooks/usePos';
import { t } from '../i18n/strings';

export default function ShiftCloseView({ shiftId, onClosed, onCancel }: { shiftId: string; onClosed: () => void; onCancel: () => void }): React.ReactElement {
  const closeShift = useCloseShift();
  const [counted, setCounted] = useState('0');
  const [result, setResult] = useState<CloseShiftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setError(null);
    try { setResult(await closeShift.mutateAsync({ shiftId, countedCash: Number(counted) })); }
    catch (err) { setError((err as Error).message); }
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
