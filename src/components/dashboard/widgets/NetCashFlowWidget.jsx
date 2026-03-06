import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import Card from '../../UI/Card';
import { useBankingStore } from '../../../stores/useBankingStore';
import { formatIDR } from '../../../utils/formatters';

const NetCashFlowWidget = () => {
    const transactions = useBankingStore((s) => s.transactions);

    const net = useMemo(() => {
        const year = new Date().getFullYear();
        return transactions
            .filter((t) => t.date && t.date.startsWith(String(year)))
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    }, [transactions]);

    const positive = net >= 0;

    return (
        <Card
            title={
                <div className="flex justify-between items-center">
                    <span className="text-sm text-neutral-500 font-normal">Net Cash Flow (YTD)</span>
                    <TrendingUp size={24} className="text-success-500" />
                </div>
            }
            padding
        >
            <div className="text-[2rem] font-bold my-2.5">{formatIDR(Math.abs(net))}</div>
            <div className={`text-sm ${positive ? 'text-success-600' : 'text-danger-600'}`}>
                {positive ? 'Positive cash flow' : 'Negative cash flow'}
            </div>
        </Card>
    );
};

export default NetCashFlowWidget;
