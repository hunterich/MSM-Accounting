import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { useInvoiceStore } from '../../../stores/useInvoiceStore';
import { formatIDR } from '../../../utils/formatters';

interface InvoiceRow extends Record<string, unknown> {
    id: string;
    client: string;
    amount: string;
    status: string;
}

const columns = [
    { key: 'id',     label: 'Invoice #' },
    { key: 'client', label: 'Client' },
    { key: 'amount', label: 'Amount', align: 'right' as const },
    { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={val as string} /> },
];

const RecentInvoicesWidget = (): React.ReactElement => {
    const navigate = useNavigate();
    const invoices = useInvoiceStore((s) => s.invoices);

    const rows = useMemo<InvoiceRow[]>(() =>
        [...invoices]
            .sort((a, b) => new Date((b.date as string | number) || 0).getTime() - new Date((a.date as string | number) || 0).getTime())
            .slice(0, 5)
            .map((inv) => ({
                id:     inv.id,
                client: (inv.customerName as string) || '—',
                amount: formatIDR(Number(inv.total || inv.amount) || 0),
                status: (inv.status as string) || 'Draft',
            })),
        [invoices]
    );

    return (
        <Card
            title="Recent Invoices"
            actions={
                <Button text="View All" variant="tertiary" size="small"
                    onClick={() => navigate('/ar/invoices')} />
            }
        >
            <Table columns={columns} data={rows} />
            {rows.length === 0 && <div className="module-empty-state">No invoices yet.</div>}
        </Card>
    );
};

export default RecentInvoicesWidget;
