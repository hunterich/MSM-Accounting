import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { useBillStore } from '../../../stores/useBillStore';
import { formatIDR } from '../../../utils/formatters';

const columns = [
    { key: 'id',      label: 'Bill #' },
    { key: 'vendor',  label: 'Vendor' },
    { key: 'amount',  label: 'Amount', align: 'right' },
    { key: 'due',     label: 'Due Date' },
    { key: 'status',  label: 'Status', render: (val) => <StatusTag status={val} /> },
];

const RecentBillsWidget = () => {
    const navigate = useNavigate();
    const bills = useBillStore((s) => s.bills);

    const rows = useMemo(() =>
        [...bills]
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
            .slice(0, 5)
            .map((b) => ({
                id:     b.id,
                vendor: b.vendor || '—',
                amount: formatIDR(Number(b.total || b.amount) || 0),
                due:    b.due || b.dueDate || '—',
                status: b.status || 'Unpaid',
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
