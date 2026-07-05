import React, { useState } from 'react';
import Modal from '@/src/components/UI/Modal';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { validateCashTender } from '@/lib/pos/tender';
import { t } from '../i18n/strings';

export default function CashTenderModal({ total, isOpen, onClose, onConfirm, busy }: { total: number; isOpen: boolean; onClose: () => void; onConfirm: (cash: number) => void; busy: boolean }): React.ReactElement {
  const [cash, setCash] = useState('');
  const cashNum = Number(cash) || 0;
  const res = validateCashTender(total, cashNum);

  const setExact = () => setCash(String(total));
  const add = (amount: number) => setCash((prev) => String((Number(prev) || 0) + amount));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('tender.cash')} size="sm">
      <div className="space-y-4">
        <div className="flex justify-between text-lg font-semibold"><span>{t('checkout.total')}</span><span>{total.toLocaleString('id-ID')}</span></div>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" text={t('tender.exact')} onClick={setExact} />
          <Button variant="secondary" text="50rb" onClick={() => add(50000)} />
          <Button variant="secondary" text="100rb" onClick={() => add(100000)} />
        </div>
        <Input id="pos-cash-received" label={t('tender.received')} type="number" value={cash} onChange={(e) => setCash(e.target.value)} />
        <div className="flex justify-between"><span>{t('tender.change')}</span><span>{res.ok ? res.change.toLocaleString('id-ID') : '—'}</span></div>
        <Button variant="primary" className="w-full" disabled={!res.ok} loading={busy} text={t('tender.complete')} onClick={() => onConfirm(cashNum)} />
      </div>
    </Modal>
  );
}
