import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { useBills } from '../../../hooks/useAP';
import { formatIDR } from '../../../utils/formatters';

interface BillRow extends Record<string, unknown> {
    id: string;
    vendor: string;
    amount: string;
    due: string;
    status: string;
}

const columns = [
    { key: 'id',      label: 'Bill #' },
    { key: 'vendor',  label: 'Vendor' },
    { key: 'amount',  label: 'Amount', align: 'right' as const },
    { key: 'due',     label: 'Due Date' },
    { key: 'status',  label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
];

const RecentBillsWidget = (): React.ReactElement => {
    const navigate = useNavigate();
    const { data, isLoading, isError } = useBills();

    const rows = useMemo<BillRow[]>(() =>
        [...(data?.data ?? [])]
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
            .slice(0, 5)
            .map((b) => ({
                id:     b.id,
                vendor: b.vendor || '—',
                amount: formatIDR(Number(b.totalAmount ?? b.amount) || 0),
                due:    b.due || b.dueDate || '—',
                status: b.status || 'Unpaid',
            })),
        [data]
    );

    return (
        <Card
            title="Recent Bills"
            actions={
                <Button text="View All" variant="tertiary" size="small"
                    onClick={() => navigate('/ap/bills')} />
            }
        >
            {isLoading ? (
                <div className="module-empty-state">Loading…</div>
            ) : isError ? (
                <div className="module-empty-state">Couldn&apos;t load bills.</div>
            ) : rows.length === 0 ? (
                <div className="module-empty-state">No bills yet.</div>
            ) : (
                <Table columns={columns} data={rows} />
            )}
        </Card>
    );
};

export default RecentBillsWidget;
