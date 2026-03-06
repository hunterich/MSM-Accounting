import React from 'react';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { Printer, Eye, Pencil } from 'lucide-react';

const mapStatusForTag = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed') return { status: 'info', label: 'Confirmed' };
    if (s === 'delivered') return { status: 'warning', label: 'Delivered' };
    if (s === 'invoiced') return { status: 'success', label: 'Invoiced' };
    if (s === 'closed') return { status: 'neutral', label: 'Closed' };
    if (s === 'draft') return { status: 'draft', label: 'Draft' };
    return { status, label: status || '-' };
};

const SOCatalogPanel = ({
    data,
    selectedId,
    filters,
    onSearchChange,
    onFilterChange,
    onDateRangeChange,
    onSelectSalesOrder,
    onViewSalesOrder,
    onEditSalesOrder,
    onPrintSalesOrder,
}) => {
    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[minmax(220px,1fr)_190px_150px_150px] gap-2 py-2.5 px-3.5 border-b border-neutral-200">
                <input
                    type="text"
                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    placeholder="Search SO # or customer..."
                    value={filters.searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                <select
                    className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    value={filters.status}
                    onChange={(e) => onFilterChange('status', e.target.value)}
                >
                    <option value="">Status: All</option>
                    <option value="Draft">Draft</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Invoiced">Invoiced</option>
                    <option value="Closed">Closed</option>
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
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">SO #</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Date</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Customer</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Status</th>
                            <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Total</th>
                            <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 && (
                            <tr>
                                <td colSpan={6} className="text-center text-neutral-600 p-5">
                                    No sales orders found
                                </td>
                            </tr>
                        )}
                        {data.map((row) => {
                            const tag = mapStatusForTag(row.status);
                            return (
                                <tr
                                    key={row.id}
                                    className={row.id === selectedId ? 'bg-primary-50' : ''}
                                    onClick={() => onSelectSalesOrder(row.id)}
                                >
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">{row.id}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">{formatDateID(row.date)}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">{row.customerName}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200"><StatusTag status={tag.status} label={tag.label} /></td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{formatIDR(row.amount)}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">
                                        <div className="flex justify-end gap-1.5">
                                            <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); onViewSalesOrder(row.id); }} title="View">
                                                <Eye size={14} />
                                            </button>
                                            <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); onEditSalesOrder(row.id); }} title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                            <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); onPrintSalesOrder(row.id); }} title="Print">
                                                <Printer size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SOCatalogPanel;
