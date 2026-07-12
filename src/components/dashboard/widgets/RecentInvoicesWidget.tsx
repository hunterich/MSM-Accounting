import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../UI/Card';
import Table from '../../UI/Table';
import StatusTag from '../../UI/StatusTag';
import Button from '../../UI/Button';
import { useInvoices } from '../../../hooks/useAR';
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
    const { data, isLoading, isError } = useInvoices();

    const rows = useMemo<InvoiceRow[]>(() =>
        [...(data?.data ?? [])]
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
            .slice(0, 5)
            .map((inv) => ({
                id:     inv.number || inv.id,
                client: inv.customerName || '—',
                amount: formatIDR(Number(inv.totalAmount ?? inv.amount) || 0),
                status: inv.status || 'Draft',
            })),
        [data]
    );

    return (
        <Card
            title="Recent Invoices"
            actions={
                <Button text="View All" variant="tertiary" size="small"
                    onClick={() => navigate('/ar/invoices')} />
            }
        >
            {isLoading ? (
                <div className="module-empty-state">Loading…</div>
            ) : isError ? (
                <div className="module-empty-state">Couldn&apos;t load invoices.</div>
            ) : rows.length === 0 ? (
                <div className="module-empty-state">No invoices yet.</div>
            ) : (
                <Table columns={columns} data={rows} />
            )}
        </Card>
    );
};

export default RecentInvoicesWidget;
