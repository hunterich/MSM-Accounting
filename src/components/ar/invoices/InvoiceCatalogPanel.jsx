import React from 'react';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { Printer, Eye, Pencil, Loader } from 'lucide-react';

const getAgeDays = (row) => {
    if (row.status === 'Paid' || row.status === 'Cancelled') return null;
    if (!row.dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((today - new Date(row.dueDate)) / 86400000);
};

const AgeBadge = ({ row }) => {
    const ageDays = getAgeDays(row);
    if (ageDays === null) return <span className="text-neutral-400">—</span>;
    if (ageDays <= 0) return <span className="text-neutral-500 text-xs">Current</span>;
    if (ageDays <= 30) return <span className="text-xs font-medium px-1.5 py-0.5 rounded text-warning-600 bg-warning-50">{ageDays}d</span>;
    if (ageDays <= 60) return <span className="text-xs font-medium px-1.5 py-0.5 rounded text-orange-600 bg-orange-50">{ageDays}d</span>;
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded text-danger-600 bg-danger-50">{ageDays}d</span>;
};

const InvoiceCatalogPanel = ({
    data,
    isLoading = false,
    selectedId,
    canEdit = true,
    filters,
    onSearchChange,
    onFilterChange,
    onDateRangeChange,
    onSelectInvoice,
    onViewInvoice,
    onEditInvoice,
    onPrintInvoice,
}) => {
    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[minmax(220px,1fr)_160px_150px_150px] gap-2 py-2.5 px-3.5 border-b border-neutral-200">
                <input
                    type="text"
                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    placeholder="Search invoice # or customer..."
                    value={filters.searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                <select
                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    value={filters.status}
                    onChange={(e) => onFilterChange('status', e.target.value)}
                >
                    <option value="">Status: All</option>
                    <option value="Paid">Paid</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Sent">Sent</option>
                    <option value="Draft">Draft</option>
                </select>
                <input
                    type="date"
                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    value={filters.dateFrom}
                    onChange={(e) => onDateRangeChange('dateFrom', e.target.value)}
                />
                <input
                    type="date"
                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    value={filters.dateTo}
                    onChange={(e) => onDateRangeChange('dateTo', e.target.value)}
                />
            </div>

            <div className="max-h-[calc(100vh-300px)] overflow-auto">
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
                                        <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); onPrintInvoice(row.id); }} title="Print">
                                            <Printer size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InvoiceCatalogPanel;
