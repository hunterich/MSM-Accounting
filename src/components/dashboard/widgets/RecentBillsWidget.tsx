import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { useBillStore } from '../../../stores/useBillStore';
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
    const bills = useBillStore((s) => s.bills);

    const rows = useMemo<BillRow[]>(() =>
        [...bills]
            .sort((a, b) => new Date((b.date as string | number) || 0).getTime() - new Date((a.date as string | number) || 0).getTime())
            .slice(0, 5)
            .map((b) => ({
                id:     b.id,
                vendor: (b.vendor as string) || '—',
                amount: formatIDR(Number(b.total || b.amount) || 0),
                due:    (b.due as string) || (b.dueDate as string) || '—',
                status: (b.status as string) || 'Unpaid',
            })),
        [bills]
    );

    return (
        <Card
            title="Recent Bills"
            actions={
                <Button text="View All" variant="tertiary" size="small"
                    onClick={() => navigate('/ap/bills')} />
            }
        >
            <Table columns={columns} data={rows} />
            {rows.length === 0 && <div className="module-empty-state">No bills yet.</div>}
        </Card>
    );
};

export default RecentBillsWidget;
