import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import Card from '../../UI/Card';
import { useBankTransactions } from '../../../hooks/useBanking';
import { formatIDR } from '../../../utils/formatters';

const NetCashFlowWidget = (): React.ReactElement => {
    // List endpoint caps at 100 rows — YTD net is computed from the most recent page.
    const { data, isLoading, isError } = useBankTransactions({ limit: 100 });

    const net = useMemo(() => {
        const year = String(new Date().getFullYear());
        return (data?.data ?? [])
            .filter((t) => t.date && t.date.startsWith(year))
            // Normalized amount is signed (expense negative, income positive).
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    }, [data]);

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
            <div className="text-[2rem] font-bold my-2.5">{isLoading || isError ? '—' : formatIDR(Math.abs(net))}</div>
            <div className={`text-sm ${isError ? 'text-danger-600' : positive ? 'text-success-600' : 'text-danger-600'}`}>
                {isError
                    ? "Couldn't load transactions"
                    : positive ? 'Positive cash flow' : 'Negative cash flow'}
            </div>
        </Card>
    );
};

export default NetCashFlowWidget;
