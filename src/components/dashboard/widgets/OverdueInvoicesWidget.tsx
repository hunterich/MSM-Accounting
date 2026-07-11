import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import Card from '../../UI/Card';
import { useInvoices } from '../../../hooks/useAR';
import { formatIDR } from '../../../utils/formatters';

const OverdueInvoicesWidget = (): React.ReactElement => {
    const { data, isLoading, isError } = useInvoices();

    // Hook normalizes the API enum OVERDUE → 'Overdue' (title case).
    const overdue = useMemo(
        () => (data?.data ?? []).filter((inv) => inv.status === 'Overdue'),
        [data]
    );
    const total = useMemo(
        () => overdue.reduce((sum, inv) => sum + (Number(inv.totalAmount ?? inv.amount) || 0), 0),
        [overdue]
    );

    return (
        <Card
            title={
                <div className="flex justify-between items-center">
                    <span className="text-sm text-neutral-500 font-normal">Overdue Invoices</span>
                    <AlertCircle size={24} className="text-danger-500" />
                </div>
            }
            padding
        >
            <div className="text-[2rem] font-bold my-2.5">{isLoading || isError ? '—' : formatIDR(total)}</div>
            <div className="text-sm text-danger-600">
                {isError
                    ? "Couldn't load invoices"
                    : `${overdue.length} invoice${overdue.length !== 1 ? 's' : ''} overdue`}
            </div>
        </Card>
    );
};

export default OverdueInvoicesWidget;
