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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('tender.cash')} size="sm">
      <div className="space-y-4">
        <div className="flex justify-between text-lg font-semibold"><span>{t('checkout.total')}</span><span>{total.toLocaleString('id-ID')}</span></div>
        <Input id="pos-cash-received" label={t('tender.received')} type="number" value={cash} onChange={(e) => setCash(e.target.value)} />
        <div className="flex justify-between"><span>{t('tender.change')}</span><span>{res.ok ? res.change.toLocaleString('id-ID') : '—'}</span></div>
        <Button variant="primary" className="w-full" disabled={!res.ok} loading={busy} text={t('tender.complete')} onClick={() => onConfirm(cashNum)} />
      </div>
    </Modal>
  );
}
