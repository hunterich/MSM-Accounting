import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import PurchaseOrderPrintTemplate from '../../components/print/PurchaseOrderPrintTemplate';
import { Plus, Search, List } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { usePurchaseOrderStore } from '../../stores/usePurchaseOrderStore';
import { useVendorStore } from '../../stores/useVendorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

const PurchaseOrders = () => {
    const navigate = useNavigate();
    const purchaseOrders = usePurchaseOrderStore((s) => s.purchaseOrders);
    const poItemTemplates = usePurchaseOrderStore((s) => s.poItemTemplates);
    const vendors = useVendorStore((s) => s.vendors);
    const company = useSettingsStore((s) => s.companyInfo);

    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ status: '' });
    const [dateRange, setDateRange] = useState({ from: '', to: '' });

    const [printPoId, setPrintPoId] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    const filteredData = useMemo(() => {
        return purchaseOrders.map((po) => {
            const vendor = vendors.find((v) => v.id === po.vendorId);
            return {
                ...po,
                vendorName: vendor ? vendor.name : po.vendorId
            };
        }).filter((item) => {
            const matchesSearch =
                item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.vendorName.toLowerCase().includes(searchTerm.toLowerCase());
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
    }, [purchaseOrders, vendors, searchTerm, filters.status, dateRange.from, dateRange.to]);

    const activePrintPo = filteredData.find((po) => po.id === printPoId)
        || purchaseOrders.find((po) => po.id === printPoId)
        || null;
    const activeVendorName = activePrintPo
        ? (vendors.find((vendor) => vendor.id === activePrintPo.vendorId)?.name || activePrintPo.vendorName || '-')
        : '-';
    const activePrintLines = activePrintPo ? (poItemTemplates[activePrintPo.id] || []) : [];

    const queuePrintPo = useCallback((poId) => {
        setPrintPoId(poId);
        setIsPreviewOpen(true);
    }, []);

    const columns = [
        { key: 'id', label: 'PO #', sortable: true },
        { key: 'vendorName', label: 'Vendor', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'expectedDate', label: 'Expected', sortable: true, render: (val) => formatDateID(val) },
        { key: 'amount', label: 'Total', align: 'right', render: (val) => formatIDR(val) },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Closed' ? 'Success' : val} label={val} /> },
        {
            key: 'actions', label: '', render: (_, row) => (
                <div className="flex gap-1.5 justify-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); navigate(`/ap/pos/edit?poId=${row.id}&mode=view`); }} />
                    <Button text="Edit" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); navigate(`/ap/pos/edit?poId=${row.id}&mode=edit`); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); queuePrintPo(row.id); }} />
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
                        onClick={() => navigate('/ap/pos/new')}
                    >
                        <Plus size={16} />
                        New PO
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_170px_170px_auto] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search PO # or vendor..."
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
                        <option value="Draft">Draft</option>
                        <option value="Approved">Approved</option>
                        <option value="Billed">Billed</option>
                        <option value="Closed">Closed</option>
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
                    columns={columns}
                    data={filteredData}
                    onRowClick={(row) => navigate(`/ap/pos/edit?poId=${row.id}&mode=view`)}
                    showCount
                    countLabel="orders"
                />
            </Card>

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Purchase Order Print Preview"
                documentTitle={`PurchaseOrder_${activePrintPo?.id || ''}`}
            >
                {activePrintPo && (
                    <PurchaseOrderPrintTemplate
                        purchaseOrder={activePrintPo}
                        lineItems={activePrintLines}
                        vendorName={activeVendorName}
                        company={company}
                    />
                )}
            </PrintPreviewModal>
        </div>
    );
};

export default PurchaseOrders;
