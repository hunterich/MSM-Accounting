// src/components/ap/bills/BillListPane.tsx
// Bills catalog. The only Bills list — the pre-workspace duplicate is gone.
// Bills have no separate detail — View/Edit open BillFormV2 as a tab.
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileUp } from 'lucide-react';
import FilterBar from '../../UI/FilterBar';
import PageHeader from '../../Layout/PageHeader';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import BillPrintTemplate from '../../print/BillPrintTemplate';
import { exportToCsv } from '../../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useBills, useUpdateBill, useVoidBill, useUnreceiveBill } from '../../../hooks/useAP';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';

const BillListPane = (): React.ReactElement => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ap_bills');
    const { open } = useWorkspaceNav();
    const { data: billsResult, isLoading } = useBills();
    const updateBill = useUpdateBill();
    const voidBill = useVoidBill();
    const unreceiveBill = useUnreceiveBill();
    const bills = useMemo(() => billsResult?.data ?? [], [billsResult?.data]);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);

    const [searchTerm, setSearchTerm] = useState('');
    const [status, setStatus] = useState('');
    const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
    const [printBillId, setPrintBillId] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    const openForm = (id: string) => open({ kind: 'doc-form', target: { module: 'ap', entity: 'bill', recordId: id, mode: 'edit' }, title: id, path: `/ap/bills/new?billId=${id}&mode=view` });
    const openNew = () => open({ kind: 'doc-form', target: { module: 'ap', entity: 'bill', recordId: null, mode: 'create' }, title: 'New bill', path: '/ap/bills/new', unique: true });
    const payBill = (billId: string) => open({ kind: 'doc-form', target: { module: 'ap', entity: 'payment', recordId: `bill:${billId}`, mode: 'create' }, title: 'Pay bill', path: '/ap/payments/new', unique: true });

    const handleApprove = (billId: string) => updateBill.mutate({ id: billId, status: 'Unpaid' });
    const handleVoid = (billId: string) => { if (!window.confirm('Void this bill? Its journal entry will be reversed. This cannot be undone.')) return; voidBill.mutate(billId, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void bill') }); };
    const handleUnreceive = (billId: string) => { if (!window.confirm('Un-receive this goods receipt? The received stock will be removed and the PO reopened. This cannot be undone.')) return; unreceiveBill.mutate(billId, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to un-receive') }); };

    const filteredData = useMemo(() => bills.filter((item) => {
        const kw = searchTerm.toLowerCase();
        const matchesSearch = item.id.toLowerCase().includes(kw) || item.vendor.toLowerCase().includes(kw);
        const matchesStatus = status ? item.status === status : true;
        let matchesDate = true;
        if (dateRange.from) matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
        if (dateRange.to) matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
        return matchesSearch && matchesStatus && matchesDate;
    }), [bills, searchTerm, status, dateRange]);

    const activePrintBill = bills.find((b) => b.id === printBillId) || null;
    // The bills list already includes its lines, so the printout is the real
    // document. This used to read a local fixture keyed by bill id, which no
    // real bill's id ever matched — every printed bill came out with an empty
    // line table.
    const activePrintLines = activePrintBill?.lines ?? [];
    const queuePrint = useCallback((id: string) => { setPrintBillId(id); setIsPreviewOpen(true); }, []);

    const columns = [
        { key: 'id', label: 'Bill #', sortable: true },
        { key: 'vendor', label: 'Vendor', sortable: true },
        { key: 'date', label: 'Issue Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'due', label: 'Due Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Paid' ? 'Success' : (val as string)} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: { id: string; _id?: string; status?: string; vendorId?: string; poNumber?: string }) => (
            <div className="flex gap-1.5 justify-end">
                {row.status === 'Draft' && <Button text="Approve" size="small" variant="primary" disabled={!canEdit || updateBill.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleApprove(row._id || row.id); }} />}
                {row.status === 'Draft' && row.poNumber && <Button text="Un-receive" size="small" variant="tertiary" disabled={!canEdit || unreceiveBill.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleUnreceive(row._id || row.id); }} />}
                {(row.status === 'Unpaid' || row.status === 'Overdue') && <Button text="Pay" size="small" variant="primary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); payBill(row.id); }} />}
                {(row.status === 'Unpaid' || row.status === 'Overdue') && <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidBill.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoid(row._id || row.id); }} />}
                <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openForm(row.id); }} />
                <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); openForm(row.id); }} />
                <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); queuePrint(row.id); }} />
            </div>
        ) },
    ];

    const handleExportCsv = () => {
        const rows = filteredData.map((bill) => ({ id: bill.id, vendor: bill.vendor, date: bill.date, due: bill.due, amount: Number(bill.amount || 0), status: bill.status, poNumber: bill.poNumber || '' }));
        exportToCsv('bills.csv', rows, [
            { label: 'Bill #', key: 'id' }, { label: 'Vendor', key: 'vendor' }, { label: 'Issue Date', key: 'date' },
            { label: 'Due Date', key: 'due' }, { label: 'Amount', key: 'amount' }, { label: 'Status', key: 'status' }, { label: 'PO Number', key: 'poNumber' },
        ]);
    };

    return (
        <div className="container ap-module container-full-width">
            <PageHeader
                title="Bills"
                subtitle="Vendor bills, due dates, and payment status."
                actions={
                    <div className="flex gap-2">
                        <Button text="Import PDF" size="small" variant="secondary" icon={<FileUp size={16} />} onClick={() => navigate('/ap/bills/import')} disabled={!canCreate} />
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="New Bill" size="small" onClick={openNew} />}
                    </div>
                }
            />

            <FilterBar
                onSearch={setSearchTerm}
                filters={[{
                    key: 'status',
                    label: 'Status',
                    options: [
                        { value: 'Paid', label: 'Paid' },
                        { value: 'Unpaid', label: 'Unpaid' },
                        { value: 'Overdue', label: 'Overdue' },
                        { value: 'Pending', label: 'Pending' },
                    ],
                }]}
                activeFilters={{ status }}
                onFilterChange={(_key, val) => setStatus(val)}
                placeholder="Search bill # or vendor..."
                extra={
                    <>
                        <label className={`acc-chip ${dateRange.from ? 'on' : ''}`}>
                            <span className="acc-chip-label">From:</span>
                            <input type="date" className="border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none" value={dateRange.from} onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))} aria-label="From date" />
                        </label>
                        <label className={`acc-chip ${dateRange.to ? 'on' : ''}`}>
                            <span className="acc-chip-label">To:</span>
                            <input type="date" className="border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none" value={dateRange.to} onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))} aria-label="To date" />
                        </label>
                        {(dateRange.from || dateRange.to) && (
                            <button type="button" className="acc-tool-btn" onClick={() => setDateRange({ from: '', to: '' })}>Clear</button>
                        )}
                    </>
                }
            />

            <Card padding={false}>
                <Table columns={columns as TableColumn<Record<string, unknown>>[]} data={filteredData as unknown as Record<string, unknown>[]} onRowClick={(row) => openForm(row['id'] as string)} showCount countLabel="bills" isLoading={isLoading} loadingLabel="Loading bills..." />
            </Card>

            <PrintPreviewModal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Bill Print Preview" documentTitle={`Bill_${activePrintBill?.id || ''}`} defaultPaperSize={printSettings.defaultPaperSize}>
                {activePrintBill && <BillPrintTemplate bill={activePrintBill as unknown as Record<string, unknown>} lineItems={activePrintLines} company={company as unknown as Record<string, unknown>} options={printSettings} />}
            </PrintPreviewModal>
        </div>
    );
};

export default BillListPane;
