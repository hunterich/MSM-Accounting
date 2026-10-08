import React, { useEffect, useRef, useState } from 'react';
import FilterBar from '../../UI/FilterBar';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { Printer, Eye, Pencil, Loader } from 'lucide-react';

interface InvoiceRow {
    id: string;
    number?: string;
    issueDate?: string;
    date?: string;
    customerName?: string;
    status?: string;
    amount?: number | string;
    dueDate?: string;
    [key: string]: unknown;
}

interface InvoiceFilters {
    searchTerm: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    [key: string]: string;
}

interface InvoiceCatalogPanelProps {
    data: InvoiceRow[];
    isLoading?: boolean;
    selectedId?: string;
    canEdit?: boolean;
    canPrint?: boolean;
    filters: InvoiceFilters;
    onSearchChange: (value: string) => void;
    onFilterChange: (key: string, value: string) => void;
    onDateRangeChange: (key: string, value: string) => void;
    onSelectInvoice: (id: string) => void;
    onViewInvoice: (id: string) => void;
    onEditInvoice: (id: string) => void;
    onPrintInvoice: (id: string) => void;
    pagination?: {
        page: number; limit: number; total: number; busy: boolean;
        onPageChange: (page: number) => void;
        onLimitChange: (limit: number) => void;
    };
}

const getAgeDays = (row: InvoiceRow): number | null => {
    if (row.status === 'Paid' || row.status === 'Cancelled') return null;
    if (!row.dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - new Date(row.dueDate).getTime()) / 86400000);
};

const AgeBadge: React.FC<{ row: InvoiceRow }> = ({ row }) => {
    const ageDays = getAgeDays(row);
    if (ageDays === null) return <span className="text-neutral-400">—</span>;
    if (ageDays <= 0) return <span className="text-neutral-500 text-xs">Current</span>;
    if (ageDays <= 30) return <span className="text-xs font-medium px-1.5 py-0.5 rounded text-warning-600 bg-warning-50">{ageDays}d</span>;
    if (ageDays <= 60) return <span className="text-xs font-medium px-1.5 py-0.5 rounded text-orange-600 bg-orange-50">{ageDays}d</span>;
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded text-danger-600 bg-danger-50">{ageDays}d</span>;
};

const InvoiceCatalogPanel: React.FC<InvoiceCatalogPanelProps> = ({
    data,
    isLoading = false,
    selectedId,
    canEdit = true,
    canPrint = true,
    filters,
    onSearchChange,
    onFilterChange,
    onDateRangeChange,
    onSelectInvoice,
    onViewInvoice,
    onEditInvoice,
    onPrintInvoice,
    pagination,
}) => {
    const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;
    const [pageInput, setPageInput] = useState(String(pagination?.page ?? 1));
    const scrollArea = useRef<HTMLDivElement>(null);
    useEffect(() => setPageInput(String(pagination?.page ?? 1)), [pagination?.page]);
    useEffect(() => {
        if (scrollArea.current) scrollArea.current.scrollTop = 0;
    }, [pagination?.page, pagination?.limit, filters.searchTerm, filters.status, filters.dateFrom, filters.dateTo]);
    const pagingButton = 'rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-100';
    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden flex min-h-0 flex-1 flex-col">
            <div className="shrink-0">
            <FilterBar
                onSearch={onSearchChange}
                filters={[{
                    key: 'status',
                    label: 'Status',
                    options: [
                        { value: 'Paid', label: 'Paid' },
                        { value: 'Overdue', label: 'Overdue' },
                        { value: 'Sent', label: 'Sent' },
                        { value: 'Draft', label: 'Draft' },
                        { value: 'Pending Approval', label: 'Pending approval' },
                        { value: 'Void', label: 'Void' },
                    ],
                }]}
                activeFilters={{ status: filters.status }}
                onFilterChange={(_key, val) => onFilterChange('status', val)}
                placeholder="Search invoice # or customer..."
                extra={
                    <>
                        <label className={`acc-chip ${filters.dateFrom ? 'on' : ''}`}>
                            <span className="acc-chip-label">From:</span>
                            <input type="date" className="border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none" value={filters.dateFrom} onChange={(e) => onDateRangeChange('dateFrom', e.target.value)} aria-label="From date" />
                        </label>
                        <label className={`acc-chip ${filters.dateTo ? 'on' : ''}`}>
                            <span className="acc-chip-label">To:</span>
                            <input type="date" className="border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none" value={filters.dateTo} onChange={(e) => onDateRangeChange('dateTo', e.target.value)} aria-label="To date" />
                        </label>
                    </>
                }
            />
            </div>

            <div ref={scrollArea} className="min-h-0 flex-1 overflow-auto" data-testid="invoice-table-scroll" tabIndex={0} aria-label="Invoice table">
                <table className="w-full border-collapse text-[0.9rem]">
                    <thead>
                        <tr>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Invoice #</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Date</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Customer</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Status</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Total</th>
                            <th className="py-[9px] px-2.5 text-center font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Age (days)</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr>
                                <td colSpan={7} className="p-5">
                                    <div className="flex items-center gap-2 text-sm text-neutral-400">
                                        <Loader size={15} className="animate-spin" /> Loading invoices…
                                    </div>
                                </td>
                            </tr>
                        )}
                        {!isLoading && data.length === 0 && (
                            <tr>
                                <td colSpan={7} className="text-center text-neutral-600 p-5">
                                    No invoices found
                                </td>
                            </tr>
                        )}
                        {data.map((row) => (
                            <tr
                                key={row.id}
                                className={row.id === selectedId ? 'bg-primary-50' : ''}
                                onClick={() => onSelectInvoice(row.id)}
                            >
                                <td className="py-[9px] px-2.5 border-b border-neutral-200">{row.number || row.id}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200">{formatDateID(row.issueDate || row.date)}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200">{row.customerName}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200"><StatusTag status={row.status} /></td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{formatIDR(row.amount)}</td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200 text-center"><AgeBadge row={row} /></td>
                                <td className="py-[9px] px-2.5 border-b border-neutral-200">
                                    <div className="flex justify-end gap-1.5">
                                        <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); onViewInvoice(row.id); }} title="View">
                                            <Eye size={14} />
                                        </button>
                                        <button className={`border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center hover:bg-neutral-100 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} onClick={(e) => { e.stopPropagation(); onEditInvoice(row.id); }} title="Edit" disabled={!canEdit}>
                                            <Pencil size={14} />
                                        </button>
                                        {canPrint && (
                                            <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); onPrintInvoice(row.id); }} title="Print">
                                                <Printer size={14} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {pagination && <nav aria-label="Invoice pagination" className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2 text-sm">
                <span aria-live="polite">
                    {pagination.busy ? 'Loading invoices…' : `Showing ${pagination.total ? (pagination.page - 1) * pagination.limit + 1 : 0}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total.toLocaleString()} invoices`}
                </span>
                <label className="flex items-center gap-1">Rows per page
                    <select aria-label="Invoices per page" value={pagination.limit} disabled={pagination.busy} onChange={(e) => pagination.onLimitChange(Number(e.target.value))}>
                        {[20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                </label>
                <div className="flex flex-wrap items-center gap-1">
                    <button type="button" className={pagingButton} aria-label="First invoice page" disabled={pagination.busy || pagination.page <= 1} onClick={() => pagination.onPageChange(1)}>First</button>
                    <button type="button" className={pagingButton} aria-label="Previous invoice page" disabled={pagination.busy || pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)}>Previous</button>
                    <span className="px-2">Page {pagination.page} of {totalPages.toLocaleString()}</span>
                    <button type="button" className={pagingButton} aria-label="Next invoice page" disabled={pagination.busy || pagination.page >= totalPages} onClick={() => pagination.onPageChange(pagination.page + 1)}>Next</button>
                    <button type="button" className={pagingButton} aria-label="Last invoice page" disabled={pagination.busy || pagination.page >= totalPages} onClick={() => pagination.onPageChange(totalPages)}>Last</button>
                    <form className="flex items-center gap-1" onSubmit={(e) => {
                        e.preventDefault();
                        const requested = Number(pageInput);
                        if (Number.isInteger(requested) && requested >= 1 && requested <= totalPages) pagination.onPageChange(requested);
                    }}>
                        <input aria-label="Go to invoice page" className="w-16 rounded border border-neutral-300 px-1" type="number" min={1} max={totalPages} step={1} value={pageInput} disabled={pagination.busy} onChange={(e) => setPageInput(e.target.value)} />
                        <button type="submit" className={pagingButton} disabled={pagination.busy}>Go</button>
                    </form>
                </div>
            </nav>}
        </div>
    );
};

export default InvoiceCatalogPanel;
