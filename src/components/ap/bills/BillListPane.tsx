// src/components/ap/bills/BillListPane.tsx
// Workspace-native Bills catalog (flag-off stays views/ap/Bills.tsx).
// Bills have no separate detail — View/Edit open BillFormV2 as a tab.
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Download, FileUp } from 'lucide-react';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import BillPrintTemplate from '../../print/BillPrintTemplate';
import { exportToCsv } from '../../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useBills, useUpdateBill, useVoidBill, useUnreceiveBill } from '../../../hooks/useAP';
import { useBillStore } from '../../../stores/useBillStore';
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
    const billItemTemplates = useBillStore((s) => s.billItemTemplates);
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
    const activePrintLines = activePrintBill ? (billItemTemplates[activePrintBill.id] || []) : [];
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
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    {canCreate && <button className="border border-primary-700 bg-primary-700 text-neutral-0 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer" onClick={openNew}><Plus size={16} />New Bill</button>}
                    <Button text="Import PDF" size="small" variant="secondary" icon={<FileUp size={16} />} onClick={() => navigate('/ap/bills/import')} disabled={!canCreate} />
                    <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_170px_170px_auto] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400" />
                    <input type="text" className="block w-full pl-[34px] px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" placeholder="Search bill # or vendor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="min-w-0">
                    <select className="block w-full px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="">Filter by Status</option><option value="Paid">Paid</option><option value="Unpaid">Unpaid</option><option value="Overdue">Overdue</option><option value="Pending">Pending</option>
                    </select>
                </div>
                <div className="min-w-0"><input type="date" className="block w-full px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" value={dateRange.from} onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))} /></div>
                <div className="min-w-0"><input type="date" className="block w-full px-3 text-base text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 focus:border-primary-500 focus:outline-0" value={dateRange.to} onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))} /></div>
                {(dateRange.from || dateRange.to) && <Button text="Clear" variant="tertiary" size="small" className="justify-self-end" onClick={() => setDateRange({ from: '', to: '' })} />}
            </div>

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
