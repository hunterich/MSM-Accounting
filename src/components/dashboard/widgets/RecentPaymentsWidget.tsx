import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { useARPayments } from '../../../hooks/useAR';
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
    const { data, isLoading, isError } = useARPayments();

    const rows = useMemo<PaymentRow[]>(() =>
        [...(data?.data ?? [])]
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
            .slice(0, 5)
            .map((p) => ({
                id:       p.id,
                customer: p.customerName || '—',
                amount:   formatIDR(Number(p.amount) || 0),
                method:   p.method || '—',
                status:   p.status || 'Pending',
            })),
        [data]
    );

    return (
        <Card
            title="Recent Payments Received"
            actions={
                <Button text="View All" variant="tertiary" size="small"
                    onClick={() => navigate('/ar/payments')} />
            }
        >
            {isLoading ? (
                <div className="module-empty-state">Loading…</div>
            ) : isError ? (
                <div className="module-empty-state">Couldn&apos;t load payments.</div>
            ) : rows.length === 0 ? (
                <div className="module-empty-state">No payments yet.</div>
            ) : (
                <Table columns={columns} data={rows} />
            )}
        </Card>
    );
};

export default RecentPaymentsWidget;
