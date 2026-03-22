import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import BillPrintTemplate from '../../components/print/BillPrintTemplate';
import { Plus, Search, List, Download, Loader } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useBills } from '../../hooks/useAP';
import { useBillStore } from '../../stores/useBillStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { exportToCsv } from '../../utils/exportCsv';

const Bills = () => {
    const navigate = useNavigate();
    const { data: billsResult, isLoading } = useBills();
    const bills = billsResult?.data ?? [];
    // billItemTemplates stays in the local store (used for print until API supports line fetch)
    const billItemTemplates = useBillStore((s) => s.billItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);

    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ status: '' });
    const [dateRange, setDateRange] = useState({ from: '', to: '' });

    const [printBillId, setPrintBillId] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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



    const queuePrintBill = useCallback((billId) => {
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
        { key: 'date', label: 'Issue Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'due', label: 'Due Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'amount', label: 'Amount', align: 'right', render: (val) => formatIDR(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Paid' ? 'Success' : val} label={val} /> },
        {
            key: 'actions', label: '', render: (_, row) => (
                <div className="flex gap-1.5 justify-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); navigate(`/ap/bills/new?billId=${row.id}&mode=view`); }} />
                    <Button text="Edit" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); navigate(`/ap/bills/edit?billId=${row.id}&mode=edit`); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); queuePrintBill(row.id); }} />
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
                        className="border border-primary-700 bg-primary-700 text-neutral-0 px-3 py-2 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => navigate('/ap/bills/new')}
                    >
                        <Plus size={16} />
                        New Bill
                    </button>
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
                {isLoading ? (
                    <div className="flex items-center gap-2 py-8 px-4 text-sm text-neutral-400">
                        <Loader size={16} className="animate-spin" /> Loading bills…
                    </div>
                ) : (
                    <Table
                        columns={columns}
                        data={filteredData}
                        onRowClick={(row) => navigate(`/ap/bills/new?billId=${row.id}&mode=view`)}
                        showCount
                        countLabel="bills"
                    />
                )}
            </Card>

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Bill Print Preview"
                documentTitle={`Bill_${activePrintBill?.id || ''}`}
            >
                {activePrintBill && (
                    <BillPrintTemplate
                        bill={activePrintBill}
                        lineItems={activePrintLines}
                        company={company}
                    />
                )}
            </PrintPreviewModal>
        </div>
    );
};

export default Bills;
