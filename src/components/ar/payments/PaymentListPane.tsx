// src/components/ar/payments/PaymentListPane.tsx
// Workspace-native AR payments catalog (flag-off path stays views/ar/Payments.tsx).
import React, { useState, useMemo } from 'react';
import { Search, Download } from 'lucide-react';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PageHeader from '../../Layout/PageHeader';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import PaymentReceiptPrintTemplate from '../../print/PaymentReceiptPrintTemplate';
import { exportToCsv } from '../../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useARPayments, useUpdateARPayment, useVoidARPayment } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';

const PaymentListPane = (): React.ReactElement => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('ar_payments');
    const { open } = useWorkspaceNav();
    const [searchTerm, setSearchTerm] = useState('');
    const [status, setStatus] = useState('');
    const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });

    const { data: paymentsResult, isLoading } = useARPayments();
    const updateARPayment = useUpdateARPayment();
    const voidARPayment = useVoidARPayment();
    const payments = useMemo(() => paymentsResult?.data ?? [], [paymentsResult?.data]);

    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [printPaymentId, setPrintPaymentId] = useState('');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const queuePrint = (id: string) => { setPrintPaymentId(id); setIsPrintOpen(true); };
    const activePrintPayment = payments.find((p) => p.id === printPaymentId) || null;

    const handleVoid = (id: string) => {
        if (!window.confirm('Void this receipt? Its journal entry will be reversed and its allocations removed. This cannot be undone.')) return;
        voidARPayment.mutate(id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void receipt') });
    };

    const openView = (id: string) => open({ kind: 'doc-view', target: { module: 'ar', entity: 'payment', recordId: id, mode: 'view' }, title: id, path: `/ar/payments?paymentId=${id}` });
    const openEdit = (id: string) => open({ kind: 'doc-form', target: { module: 'ar', entity: 'payment', recordId: id, mode: 'edit' }, title: `Edit ${id}`, path: `/ar/payments/edit?paymentId=${id}` });
    const openNew = () => open({ kind: 'doc-form', target: { module: 'ar', entity: 'payment', recordId: null, mode: 'create' }, title: 'Record payment', path: '/ar/payments/new', unique: true });

    const filteredData = useMemo(() => payments.filter((item) => {
        const kw = searchTerm.toLowerCase();
        const matchesSearch = item.customerName.toLowerCase().includes(kw) || item.invoiceId.toLowerCase().includes(kw) || item.id.toLowerCase().includes(kw);
        const matchesStatus = status ? item.status === status : true;
        let matchesDate = true;
        if (dateRange.from) matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
        if (dateRange.to) matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
        return matchesSearch && matchesStatus && matchesDate;
    }), [searchTerm, status, payments, dateRange]);

    const columns = [
        { key: 'id', label: 'Payment #' },
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceId', label: 'Invoice Ref' },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Completed' ? 'Success' : 'Warning'} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="row-actions-end">
                {row['status'] === 'Draft' && <Button text="Complete" size="small" variant="primary" disabled={!canEdit || updateARPayment.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); updateARPayment.mutate({ id: (row['_id'] || row['id']) as string, status: 'Completed' }); }} />}
                {row['status'] === 'Completed' && <Button text="Void" size="small" variant="tertiary" disabled={!canDelete || voidARPayment.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoid((row['_id'] || row['id']) as string); }} />}
                <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openView(row['id'] as string); }} />
                <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEdit(row['id'] as string); }} />
                <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); queuePrint(row['id'] as string); }} />
            </div>
        ) },
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((p) => ({ id: p.id, date: p.date, customerName: p.customerName, method: p.method, amount: p.amount, status: p.status }));
        exportToCsv('ar-payments.csv', rows, [
            { label: 'Number', key: 'id' }, { label: 'Date', key: 'date' }, { label: 'Customer', key: 'customerName' },
            { label: 'Method', key: 'method' }, { label: 'Amount', key: 'amount' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Customer Payments"
                subtitle="Record and track incoming payments against invoices."
                actions={
                    <div className="flex gap-2">
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="Record Payment" size="small" onClick={openNew} />}
                    </div>
                }
            />
            <div className="payments-filter-card">
                <div className="payments-filter-search">
                    <Search size={18} />
                    <input type="text" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" placeholder="Search payment # or customer..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="payments-filter-field">
                    <select className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="">Filter by Status</option>
                        <option value="Draft">Draft</option>
                        <option value="Completed">Completed</option>
                        <option value="Processing">Processing</option>
                    </select>
                </div>
                <div className="payments-filter-field">
                    <input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={dateRange.from} onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))} />
                </div>
                <div className="payments-filter-field">
                    <input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={dateRange.to} onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))} />
                </div>
                {(dateRange.from || dateRange.to) && <Button text="Clear" variant="tertiary" size="small" className="payments-filter-clear" onClick={() => setDateRange({ from: '', to: '' })} />}
            </div>
            <Card padding={false}>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={filteredData as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => openView(row['id'] as string)}
                    showCount countLabel="payments" isLoading={isLoading} loadingLabel="Loading payments..."
                />
            </Card>

            <PrintPreviewModal
                isOpen={isPrintOpen}
                onClose={() => setIsPrintOpen(false)}
                title="Payment Receipt Preview"
                documentTitle={`Receipt_${activePrintPayment?.number || activePrintPayment?.id || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                <PaymentReceiptPrintTemplate payment={activePrintPayment} direction="in" partyName={activePrintPayment?.customerName} company={company} options={printSettings} />
            </PrintPreviewModal>
        </div>
    );
};

export default PaymentListPane;
