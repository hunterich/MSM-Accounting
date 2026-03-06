import React from 'react';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';

const mapStatusForTag = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed') return { status: 'info', label: 'Confirmed' };
    if (s === 'delivered') return { status: 'warning', label: 'Delivered' };
    if (s === 'invoiced') return { status: 'success', label: 'Invoiced' };
    if (s === 'closed') return { status: 'neutral', label: 'Closed' };
    if (s === 'draft') return { status: 'draft', label: 'Draft' };
    return { status, label: status || '-' };
};

const SOSummaryTab = ({ salesOrder }) => {
    const tag = mapStatusForTag(salesOrder.status);

    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">SO #</label>
                <strong>{salesOrder.id}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Status</label>
                <StatusTag status={tag.status} label={tag.label} />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Customer</label>
                <strong>{salesOrder.customerName || '-'}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Currency</label>
                <strong>{salesOrder.currency || 'IDR'}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Order Date</label>
                <strong>{formatDateID(salesOrder.date)}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Expected Date</label>
                <strong>{formatDateID(salesOrder.expectedDate)}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Total</label>
                <strong className="text-primary-500">{formatIDR(salesOrder.amount)}</strong>
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5 col-span-2">
                <label className="block text-[0.78rem] text-neutral-600 mb-1">Notes</label>
                <div>{salesOrder.notes || '-'}</div>
            </div>
        </div>
    );
};

export default SOSummaryTab;
