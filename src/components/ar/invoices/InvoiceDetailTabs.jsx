import React, { useState } from 'react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import InvoiceSummaryTab from './InvoiceSummaryTab';
import InvoiceItemsTab from './InvoiceItemsTab';
import InvoiceLogisticsTab from './InvoiceLogisticsTab';
import InvoiceAttachmentsTab from './InvoiceAttachmentsTab';
import InvoiceAuditJournalTab from './InvoiceAuditJournalTab';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';

const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'items', label: 'Items' },
    { id: 'logistics', label: 'Logistics' },
    { id: 'attachments', label: 'Attachments' },
    { id: 'audit', label: 'Audit / Journal' }
];

const InvoiceDetailTabs = ({ invoice, onEdit, onPrint, canEdit = true, canDelete = false }) => {
    const [activeTab, setActiveTab] = useState('items');

    const renderTabContent = () => {
        switch (activeTab) {
            case 'summary':
                return <InvoiceSummaryTab invoice={invoice} />;
            case 'items':
                return <InvoiceItemsTab invoice={invoice} />;
            case 'logistics':
                return <InvoiceLogisticsTab invoice={invoice} />;
            case 'attachments':
                return <InvoiceAttachmentsTab invoice={invoice} />;
            case 'audit':
                return <InvoiceAuditJournalTab invoice={invoice} />;
            default:
                return null;
        }
    };

    return (
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between py-2.5 px-3.5 border-b border-neutral-200">
                <div className="flex items-center gap-2.5">
                    <h2 className="m-0 text-xl font-semibold">{invoice.number || invoice.id}</h2>
                    <StatusTag status={invoice.status} />
                </div>
                <div className="flex gap-2">
                    <Button text="Print" size="small" variant="secondary" onClick={onPrint} />
                    <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={onEdit} />
                </div>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-0 border-b border-neutral-200">
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Customer</label>
                    <div>{invoice.customerName}</div>
                </div>
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Date</label>
                    <div>{formatDateID(invoice.issueDate || invoice.date || '') || '-'}</div>
                </div>
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">Currency</label>
                    <div>{invoice.currency || 'IDR'}</div>
                </div>
                <div className="py-2 px-3 border-r border-neutral-200">
                    <label className="block text-[0.78rem] text-neutral-600 mb-1">No Faktur #</label>
                    <div>{invoice.number || invoice.id}</div>
                </div>
                <div className="py-2 px-3 font-bold text-lg text-primary-700 flex items-center">
                    {formatIDR(invoice.amount)}
                </div>
            </div>

            <div className="flex">
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
                <div className="flex flex-col gap-1 p-2 border-l border-neutral-200">
                    <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[34px] h-[34px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" title="Details"><FileText size={18} /></button>
                    <button className="border border-neutral-300 bg-neutral-0 text-neutral-700 w-[34px] h-[34px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" title="Attachments"><Paperclip size={18} /></button>
                    <button className="border border-neutral-300 bg-neutral-0 text-success-600 w-[34px] h-[34px] rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-neutral-100" title="More"><MoreHorizontal size={18} /></button>
                    <button className={`border border-neutral-300 bg-neutral-0 text-danger-500 w-[34px] h-[34px] rounded-md inline-flex items-center justify-center hover:bg-neutral-100 ${canDelete ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title="Delete" disabled={!canDelete}><Trash2 size={18} /></button>
                </div>
            </div>
        </div>
    );
};

export default InvoiceDetailTabs;
