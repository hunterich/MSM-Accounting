import React, { useMemo } from 'react';
import { FileText } from 'lucide-react';
import Card from '../../UI/Card';
import { useBillStore } from '../../../stores/useBillStore';
import { formatIDR } from '../../../utils/formatters';

const OutstandingBillsWidget = () => {
    const bills = useBillStore((s) => s.bills);

    const unpaid = useMemo(
        () => bills.filter((b) => b.status !== 'Paid'),
        [bills]
    );
    const total = useMemo(
        () => unpaid.reduce((sum, b) => sum + (Number(b.total || b.amount) || 0), 0),
        [unpaid]
    );

    return (
        <Card
            title={
                <div className="flex justify-between items-center">
                    <span className="text-sm text-neutral-500 font-normal">Outstanding Bills</span>
                    <FileText size={24} className="text-warning-500" />
                </div>
            }
            padding
        >
            <div className="text-[2rem] font-bold my-2.5">{formatIDR(total)}</div>
            <div className="text-sm text-danger-600">
                {unpaid.length} bill{unpaid.length !== 1 ? 's' : ''} pending
            </div>
        </Card>
    );
};

export default OutstandingBillsWidget;
