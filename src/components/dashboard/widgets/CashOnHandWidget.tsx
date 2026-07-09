import React, { useMemo } from 'react';
import { Wallet } from 'lucide-react';
import Card from '../../UI/Card';
import { useBankAccounts } from '../../../hooks/useBanking';
import { formatIDR } from '../../../utils/formatters';

const CashOnHandWidget = (): React.ReactElement => {
    const { data: bankAccounts, isLoading, isError } = useBankAccounts();

    const total = useMemo(
        () => (bankAccounts ?? []).reduce((sum, a) => sum + (Number(a.balance) || 0), 0),
        [bankAccounts]
    );
    const count = bankAccounts?.length ?? 0;

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
            <div className="text-[2rem] font-bold my-2.5">{isLoading || isError ? '—' : formatIDR(total)}</div>
            <div className={`text-sm ${isError ? 'text-danger-600' : 'text-success-600'}`}>
                {isError
                    ? "Couldn't load accounts"
                    : `${count} account${count !== 1 ? 's' : ''}`}
            </div>
        </Card>
    );
};

export default CashOnHandWidget;
