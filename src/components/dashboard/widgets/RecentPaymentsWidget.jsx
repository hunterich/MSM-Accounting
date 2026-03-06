import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { usePaymentStore } from '../../../stores/usePaymentStore';
import { formatIDR } from '../../../utils/formatters';

const columns = [
    { key: 'id',       label: 'Payment #' },
    { key: 'customer', label: 'Customer' },
    { key: 'amount',   label: 'Amount', align: 'right' },
    { key: 'method',   label: 'Method' },
    { key: 'status',   label: 'Status', render: (val) => <StatusTag status={val} /> },
];

const RecentPaymentsWidget = () => {
    const navigate = useNavigate();
    const payments = usePaymentStore((s) => s.payments);

    const rows = useMemo(() =>
        [...payments]
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
            .slice(0, 5)
            .map((p) => ({
                id:       p.id,
                customer: p.customerName || '—',
                amount:   formatIDR(Number(p.amount) || 0),
                method:   p.method || '—',
                status:   p.status || 'Pending',
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
