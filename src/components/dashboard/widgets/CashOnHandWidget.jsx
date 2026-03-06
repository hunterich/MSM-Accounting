import React, { useMemo } from 'react';
import { Wallet } from 'lucide-react';
import Card from '../../UI/Card';
import { useBankingStore } from '../../../stores/useBankingStore';
import { formatIDR } from '../../../utils/formatters';

const CashOnHandWidget = () => {
    const bankAccounts = useBankingStore((s) => s.bankAccounts);

    const total = useMemo(
        () => bankAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0),
        [bankAccounts]
    );

    return (
        <Card
            title={
                <div className="flex justify-between items-center">
                    <span className="text-sm text-neutral-500 font-normal">Cash on Hand</span>
                    <Wallet size={24} className="text-primary-500" />
                </div>
            }
            padding
        >
            <div className="text-[2rem] font-bold my-2.5">{formatIDR(total)}</div>
            <div className="text-sm text-success-600">
                {bankAccounts.length} account{bankAccounts.length !== 1 ? 's' : ''}
            </div>
        </Card>
    );
};

export default CashOnHandWidget;
