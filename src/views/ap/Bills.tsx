import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import BillPrintTemplate from '../../components/print/BillPrintTemplate';
import { Plus, Search, List, Download, FileUp } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useBills, useUpdateBill } from '../../hooks/useAP';
import { useBillStore } from '../../stores/useBillStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { exportToCsv } from '../../utils/exportCsv';
import { useModulePermissions } from '../../hooks/useModulePermissions';

interface BillFilters {
    status: string;
}

interface DateRange {
    from: string;
    to: string;
}

const Bills = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('ap_bills');
    const { data: billsResult, isLoading } = useBills();
    const updateBill = useUpdateBill();
    const bills = billsResult?.data ?? [];

    const handleApprove = (billId: string) => {
        // Draft → Unpaid (OPEN): the bill enters AP aging and becomes payable.
        updateBill.mutate({ id: billId, status: 'Unpaid' });
    };
    // billItemTemplates stays in the local store (used for print until API supports line fetch)
    const billItemTemplates = useBillStore((s) => s.billItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);

    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<BillFilters>({ status: '' });
    const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });

    const [printBillId, setPrintBillId] = useState<string>('');
    const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);

    const filteredData = useMemo(() => {
        return bills.filter((item) => {
            const matchesSearch =
                item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.vendor.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filters.status ? item.status === filters.status : true;

            let matchesDate = true;
            if (dateRange.from) {
                matchesDate = matchesDate && new Date(item.date) >= new Date(dateRange.from);
            }
            if (dateRange.to) {
                matchesDate = matchesDate && new Date(item.date) <= new Date(dateRange.to);
            }

            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [bills, searchTerm, filters.status, dateRange.from, dateRange.to]);

    const activePrintBill = bills.find((bill) => bill.id === printBillId) || null;
    const activePrintLines = activePrintBill ? (billItemTemplates[activePrintBill.id] || []) : [];



    const queuePrintBill = useCallback((billId: string) => {
        setPrintBillId(billId);
        setIsPreviewOpen(true);
    }, []);

    const handleExportCsv = () => {
        const rows = filteredData.map((bill) => ({
            id: bill.id,
            vendor: bill.vendor,
            date: bill.date,
            due: bill.due,
            amount: Number(bill.amount || 0),
            status: bill.status,
            poNumber: bill.poNumber || '',
        }));

        exportToCsv('bills.csv', rows, [
            { label: 'Bill #', key: 'id' },
            { label: 'Vendor', key: 'vendor' },
            { label: 'Issue Date', key: 'date' },
            { label: 'Due Date', key: 'due' },
            { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' },
            { label: 'PO Number', key: 'poNumber' },
        ]);
    };

    const columns = [
        { key: 'id', label: 'Bill #', sortable: true },
        { key: 'vendor', label: 'Vendor', sortable: true },
        { key: 'date', label: 'Issue Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'due', label: 'Due Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Paid' ? 'Success' : (val as string)} label={val as string} /> },
        {
            key: 'actions', label: '', render: (_: unknown, row: { id: string; _id?: string; status?: string; vendorId?: string }) => (
                <div className="flex gap-1.5 justify-end">
                    {row.status === 'Draft' && (
                        <Button
                            text="Approve"
                            size="small"
                            variant="primary"
                            disabled={!canEdit || updateBill.isPending}
                            onClick={(event: React.MouseEvent) => { event.stopPropagation(); handleApprove(row._id || row.id); }}
                        />
                    )}
                    {(row.status === 'Unpaid' || row.status === 'Overdue') && (
                        <Button
                            text="Pay"
                            size="small"
                            variant="primary"
                            onClick={(event: React.MouseEvent) => {
                                event.stopPropagation();
                                navigate('/ap/payments/new', { state: { mode: 'create', vendorId: row.vendorId, payBillId: row.id } });
                            }}
                        />
                    )}
                    <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); navigate(`/ap/bills/new?billId=${row.id}&mode=view`); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(event: React.MouseEvent) => { event.stopPropagation(); navigate(`/ap/bills/edit?billId=${row.id}&mode=edit`); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); queuePrintBill(row.id); }} />
                </div>
            )
        }
    ];

    return (
        <div className="max-w-full mx-auto">
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    <button
                        className="border border-[#b9ddff] bg-[#e8f4ff] text-primary-700 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => {
                            setSearchTerm('');
                            setFilters({ status: '' });
                            setDateRange({ from: '', to: '' });
                        }}
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    <button
                        className={`border border-primary-700 bg-primary-700 text-neutral-0 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold ${canCreate ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                        onClick={() => navigate('/ap/bills/new')}
                        disabled={!canCreate}
                    >
                        <Plus size={16} />
                        New Bill
                    </button>
                    <Button
                        text="Import PDF"
                        size="small"
                        variant="secondary"
                        icon={<FileUp size={16} />}
                        onClick={() => navigate('/ap/bills/import')}
                        disabled={!canCreate}
                    />
                    <Button
                        text="Export CSV"
                        size="small"
                        variant="secondary"
                        icon={<Download size={16} />}
                        onClick={handleExportCsv}
                    />
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_170px_170px_auto] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search bill # or vendor..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.status}
                        onChange={(event) => setFilters({ status: event.target.value })}
                    >
                        <option value="">Filter by Status</option>
                        <option value="Paid">Paid</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="Overdue">Overdue</option>
                        <option value="Pending">Pending</option>
                    </select>
                </div>
                <div className="min-w-0">
                    <input
                        type="date"
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={dateRange.from}
                        onChange={(event) => setDateRange((prev) => ({ ...prev, from: event.target.value }))}
                    />
                </div>
                <div className="min-w-0">
                    <input
                        type="date"
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={dateRange.to}
                        onChange={(event) => setDateRange((prev) => ({ ...prev, to: event.target.value }))}
                    />
                </div>
                {(dateRange.from || dateRange.to) && (
                    <Button
                        text="Clear"
                        variant="tertiary"
                        size="small"
                        className="justify-self-end"
                        onClick={() => setDateRange({ from: '', to: '' })}
                    />
                )}
            </div>

            <Card padding={false}>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={filteredData as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => navigate(`/ap/bills/new?billId=${row['id'] as string}&mode=view`)}
                    showCount
                    countLabel="bills"
                    isLoading={isLoading}
                    loadingLabel="Loading bills..."
                />
            </Card>

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Bill Print Preview"
                documentTitle={`Bill_${activePrintBill?.id || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                {/* casts: local Bill/CompanyInfo lack index signatures required by print template */}
                {activePrintBill && (
                    <BillPrintTemplate
                        bill={activePrintBill as unknown as Record<string, unknown>}
                        lineItems={activePrintLines}
                        company={company as unknown as Record<string, unknown>}
                        options={printSettings}
                    />
                )}
            </PrintPreviewModal>
        </div>
    );
};

export default Bills;
