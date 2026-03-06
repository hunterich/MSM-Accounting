import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import Card from '../../UI/Card';
import { useInvoiceStore } from '../../../stores/useInvoiceStore';
import { formatIDR } from '../../../utils/formatters';

const OverdueInvoicesWidget = () => {
    const invoices = useInvoiceStore((s) => s.invoices);

    const overdue = useMemo(
        () => invoices.filter((inv) => inv.status === 'Overdue'),
        [invoices]
    );
    const total = useMemo(
        () => overdue.reduce((sum, inv) => sum + (Number(inv.total || inv.amount) || 0), 0),
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
            <div className="text-[2rem] font-bold my-2.5">{formatIDR(total)}</div>
            <div className="text-sm text-danger-600">
                {overdue.length} invoice{overdue.length !== 1 ? 's' : ''} overdue
            </div>
        </Card>
    );
};

export default OverdueInvoicesWidget;
