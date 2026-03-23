import React, { useState } from 'react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import SOSummaryTab from './SOSummaryTab';
import SOItemsTab from './SOItemsTab';
import { formatDateID, formatIDR } from '../../../utils/formatters';

const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'items', label: 'Items' },
    { id: 'logistics', label: 'Logistics' },
    { id: 'activity', label: 'Activity' },
];

const mapStatusForTag = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed') return { status: 'info', label: 'Confirmed' };
    if (s === 'delivered') return { status: 'warning', label: 'Delivered' };
    if (s === 'invoiced') return { status: 'success', label: 'Invoiced' };
    if (s === 'closed') return { status: 'neutral', label: 'Closed' };
    if (s === 'draft') return { status: 'draft', label: 'Draft' };
    return { status, label: status || '-' };
};

const SODetailTabs = ({ salesOrder, lineItems = [], onEdit, onPrint, onConvertToInvoice, canEdit = true, canConvertToInvoice = true }) => {
    const [activeTab, setActiveTab] = useState('summary');
    const tag = mapStatusForTag(salesOrder.status);
    const canConvert = ['Confirmed', 'Delivered'].includes(salesOrder.status);

    const renderTabContent = () => {
        if (activeTab === 'summary') {
            return <SOSummaryTab salesOrder={salesOrder} />;
        }

        if (activeTab === 'items') {
            return <SOItemsTab lineItems={lineItems} />;
        }

        if (activeTab === 'logistics') {
            return (
                <div className="grid grid-cols-2 gap-3">
                    <div className="border border-neutral-200 rounded-lg p-2.5">
                        <label className="block text-[0.78rem] text-neutral-600 mb-1">Expected Delivery Date</label>
                        <div>{formatDateID(salesOrder.expectedDate)}</div>
                    </div>
                    <div className="border border-neutral-200 rounded-lg p-2.5">
                        <label className="block text-[0.78rem] text-neutral-600 mb-1">Order Date</label>
                        <div>{formatDateID(salesOrder.date)}</div>
                    </div>
                    <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                        <label className="block text-[0.78rem] text-neutral-600 mb-1">Shipping Address</label>
                        <div>{salesOrder.shippingAddress || '-'}</div>
                    </div>
                    <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                        <label className="block text-[0.78rem] text-neutral-600 mb-1">Delivery Notes</label>
                        <div>{salesOrder.deliveryNotes || '-'}</div>
                    </div>
                </div>
            );
        }

        return (
            <div className="text-neutral-600 text-[0.95rem]">No activity yet.</div>
        );
    };

    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between py-2.5 px-3.5 border-b border-neutral-200">
                <div className="flex items-center gap-2.5">
                    <h2 className="m-0 text-xl font-semibold">{salesOrder.id}</h2>
                    <StatusTag status={tag.status} label={tag.label} />
                </div>
                <div className="flex gap-2">
                    {canConvert ? <Button text="Convert to Invoice" size="small" variant="primary" disabled={!canConvertToInvoice} onClick={onConvertToInvoice} /> : null}
                    <Button text="Print" size="small" variant="secondary" onClick={onPrint} />
                    <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={onEdit} />
                </div>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-0 border-b border-neutral-200">
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Customer</label>
                    <div>{salesOrder.customerName}</div>
                </div>
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Date</label>
                    <div>{formatDateID(salesOrder.date)}</div>
                </div>
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Currency</label>
                    <div>{salesOrder.currency || 'IDR'}</div>
                </div>
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Expected</label>
                    <div>{formatDateID(salesOrder.expectedDate)}</div>
                </div>
                <div className="py-2 px-3 font-bold text-lg text-primary-700 flex items-center">
                    {formatIDR(salesOrder.amount)}
                </div>
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex gap-1 border-b border-neutral-200 px-2 pt-2">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            className={`border border-transparent border-b-2 border-b-transparent bg-transparent text-neutral-600 py-2 px-2.5 cursor-pointer font-semibold text-[0.85rem] ${activeTab === tab.id ? '!text-primary-700 !border-b-primary-600' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="p-3.5">
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
};

export default SODetailTabs;
