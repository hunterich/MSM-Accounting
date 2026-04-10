import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { usePaymentStore } from '../../../stores/usePaymentStore';
import { formatIDR } from '../../../utils/formatters';

interface PaymentRow extends Record<string, unknown> {
    id: string;
    customer: string;
    amount: string;
    method: string;
    status: string;
}

const columns = [
    { key: 'id',       label: 'Payment #' },
    { key: 'customer', label: 'Customer' },
    { key: 'amount',   label: 'Amount', align: 'right' as const },
    { key: 'method',   label: 'Method' },
    { key: 'status',   label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
];

const RecentPaymentsWidget = (): React.ReactElement => {
    const navigate = useNavigate();
    const payments = usePaymentStore((s) => s.payments);

    const rows = useMemo<PaymentRow[]>(() =>
        [...payments]
            .sort((a, b) => new Date((b.date as string | number) || 0).getTime() - new Date((a.date as string | number) || 0).getTime())
            .slice(0, 5)
            .map((p) => ({
                id:       p.id,
                customer: (p.customerName as string) || '—',
                amount:   formatIDR(Number(p.amount) || 0),
                method:   (p.method as string) || '—',
                status:   (p.status as string) || 'Pending',
            })),
        [payments]
    );

    return (
        <Card
            title="Recent Payments Received"
            actions={
                <Button text="View All" variant="tertiary" size="small"
                    onClick={() => navigate('/ar/payments')} />
            }
        >
            <Table columns={columns} data={rows} />
            {rows.length === 0 && <div className="module-empty-state">No payments yet.</div>}
        </Card>
    );
};

export default RecentPaymentsWidget;
