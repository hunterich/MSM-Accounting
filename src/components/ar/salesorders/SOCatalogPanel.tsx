import React from 'react';
import FilterBar from '../../UI/FilterBar';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { Printer, Eye, Pencil } from 'lucide-react';

interface SalesOrderRow {
    id: string;
    date?: string;
    customerName?: string;
    status?: string;
    amount?: number | string;
    [key: string]: unknown;
}

interface SOFilters {
    searchTerm: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    [key: string]: string;
}

interface SOCatalogPanelProps {
    data: SalesOrderRow[];
    selectedId?: string;
    canEdit?: boolean;
    filters: SOFilters;
    onSearchChange: (value: string) => void;
    onFilterChange: (key: string, value: string) => void;
    onDateRangeChange: (key: string, value: string) => void;
    onSelectSalesOrder: (id: string) => void;
    onViewSalesOrder: (id: string) => void;
    onEditSalesOrder: (id: string) => void;
    onPrintSalesOrder: (id: string) => void;
}

const mapStatusForTag = (status: string | undefined): { status: string; label: string } => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed') return { status: 'info', label: 'Confirmed' };
    if (s === 'delivered') return { status: 'warning', label: 'Delivered' };
    if (s === 'invoiced') return { status: 'success', label: 'Invoiced' };
    if (s === 'closed') return { status: 'neutral', label: 'Closed' };
    if (s === 'draft') return { status: 'draft', label: 'Draft' };
    return { status: status || '', label: status || '-' };
};

const SOCatalogPanel: React.FC<SOCatalogPanelProps> = ({
    data,
    selectedId,
    canEdit = true,
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
            <FilterBar
                onSearch={onSearchChange}
                filters={[{
                    key: 'status',
                    label: 'Status',
                    options: [
                        { value: 'Draft', label: 'Draft' },
                        { value: 'Confirmed', label: 'Confirmed' },
                        { value: 'Delivered', label: 'Delivered' },
                        { value: 'Invoiced', label: 'Invoiced' },
                        { value: 'Closed', label: 'Closed' },
                    ],
                }]}
                activeFilters={{ status: filters.status }}
                onFilterChange={(_key, val) => onFilterChange('status', val)}
                placeholder="Search SO # or customer..."
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
                                            <button className={`border border-neutral-300 bg-neutral-0 text-neutral-700 w-[26px] h-[26px] rounded-md inline-flex items-center justify-center hover:bg-neutral-100 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} onClick={(e) => { e.stopPropagation(); onEditSalesOrder(row.id); }} title="Edit" disabled={!canEdit}>
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
