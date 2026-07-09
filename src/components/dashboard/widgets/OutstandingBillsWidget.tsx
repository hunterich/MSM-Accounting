import React, { useMemo } from 'react';
import { FileText } from 'lucide-react';
import Card from '../../UI/Card';
import { useBills } from '../../../hooks/useAP';
import { formatIDR } from '../../../utils/formatters';

const OutstandingBillsWidget = (): React.ReactElement => {
    const { data, isLoading, isError } = useBills();

    const unpaid = useMemo(
        // A voided bill is no longer a liability, so it isn't outstanding.
        () => (data?.data ?? []).filter((b) => b.status !== 'Paid' && b.status !== 'Void'),
        [data]
    );
    const total = useMemo(
        () => unpaid.reduce((sum, b) => sum + (Number(b.totalAmount ?? b.amount) || 0), 0),
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
            <div className="text-[2rem] font-bold my-2.5">{isLoading || isError ? '—' : formatIDR(total)}</div>
            <div className="text-sm text-danger-600">
                {isError
                    ? "Couldn't load bills"
                    : `${unpaid.length} bill${unpaid.length !== 1 ? 's' : ''} pending`}
            </div>
        </Card>
    );
};

export default OutstandingBillsWidget;
