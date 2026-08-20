// src/components/ar/deliverynotes/DeliveryNoteListPane.tsx
// Delivery Notes catalog. The only such list — the pre-workspace duplicate is gone.
import React, { useMemo, useState } from 'react';
import FilterBar from '../../UI/FilterBar';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import ListPage from '../../Layout/ListPage';
import { Plus, Download } from 'lucide-react';
import { exportToCsv } from '../../../utils/exportCsv';
import { formatDateID } from '../../../utils/formatters';
import { useDeliveryNotes, type DeliveryNote } from '../../../hooks/useAR';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import DeliveryNotePrintTemplate from '../../print/DeliveryNotePrintTemplate';

const dnStatusVariant = (status: string): string => (status === 'Delivered' ? 'Success' : status === 'Cancelled' ? 'Danger' : 'neutral');

const DeliveryNoteListPane = (): React.ReactElement => {
    const { canCreate } = useModulePermissions('ar_sales_orders');
    const { open } = useWorkspaceNav();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const { data: dnResult, isLoading } = useDeliveryNotes({});
    const notes = useMemo<DeliveryNote[]>(() => dnResult?.data ?? [], [dnResult?.data]);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [printNoteId, setPrintNoteId] = useState('');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const activePrintNote = notes.find((n) => n.id === printNoteId) || null;

    const openNew = () => open({ kind: 'doc-form', target: { module: 'ar', entity: 'delivery-note', recordId: null, mode: 'create' }, title: 'New delivery note', path: '/ar/delivery-notes/new', unique: true });

    const filtered = useMemo(() => {
        const kw = searchTerm.toLowerCase();
        return notes.filter((n) => {
            const matchesSearch = (n.id || '').toLowerCase().includes(kw) || (n.salesOrderNumber || '').toLowerCase().includes(kw) || (n.customerName || '').toLowerCase().includes(kw);
            const matchesStatus = statusFilter ? n.status === statusFilter : true;
            return matchesSearch && matchesStatus;
        });
    }, [notes, searchTerm, statusFilter]);

    const columns: TableColumn<Record<string, unknown>>[] = [
        { key: 'id', label: 'Number', sortable: true },
        { key: 'salesOrderNumber', label: 'Sales Order #', sortable: true },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val as string) },
        { key: 'warehouseName', label: 'Warehouse' },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={dnStatusVariant(val as string)} label={val as string} /> },
        { key: 'lines', label: 'Items', align: 'right', render: (val) => Array.isArray(val) ? String(val.length) : '—' },
        { key: 'actions', label: '', render: (_, row) => <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPrintNoteId(row['id'] as string); setIsPrintOpen(true); }} /> },
    ];

    const handleExportCsv = () => {
        const rows = filtered.map((dn) => ({ id: dn.id, salesOrderNumber: dn.salesOrderNumber || '', customerName: dn.customerName || '', date: dn.date, warehouseName: dn.warehouseName || '', status: dn.status }));
        exportToCsv('delivery-notes.csv', rows, [
            { label: 'Number', key: 'id' }, { label: 'SO Number', key: 'salesOrderNumber' }, { label: 'Customer', key: 'customerName' },
            { label: 'Date', key: 'date' }, { label: 'Warehouse', key: 'warehouseName' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <ListPage
            title="Delivery Notes"
            subtitle="Track goods dispatched to customers."
            actions={
                <div className="flex items-center gap-2">
                    <button className="btn btn-secondary flex items-center gap-1" title="Export CSV" onClick={handleExportCsv}><Download size={16} /><span className="hidden sm:inline">Export</span></button>
                    <Button text="New Delivery Note" variant="primary" icon={<Plus size={16} />} disabled={!canCreate} onClick={openNew} />
                </div>
            }
        >
            <FilterBar
                onSearch={setSearchTerm}
                filters={[{
                    key: 'status',
                    label: 'Status',
                    options: [
                        { value: 'Draft', label: 'Draft' },
                        { value: 'Delivered', label: 'Delivered' },
                        { value: 'Cancelled', label: 'Cancelled' },
                    ],
                }]}
                activeFilters={{ status: statusFilter }}
                onFilterChange={(_key, val) => setStatusFilter(val)}
                placeholder="Search by number, SO, or customer..."
            />

            <Card padding={false}>
                <Table columns={columns} data={filtered as unknown as Record<string, unknown>[]} isLoading={isLoading} loadingLabel="Loading delivery notes..." showCount countLabel="delivery notes" />
            </Card>

            <PrintPreviewModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} title="Delivery Note Print Preview" documentTitle={`DeliveryNote_${activePrintNote?.number || activePrintNote?.id || ''}`} defaultPaperSize={printSettings.defaultPaperSize}>
                <DeliveryNotePrintTemplate deliveryNote={activePrintNote} company={company} options={printSettings} />
            </PrintPreviewModal>
        </ListPage>
    );
};

export default DeliveryNoteListPane;
