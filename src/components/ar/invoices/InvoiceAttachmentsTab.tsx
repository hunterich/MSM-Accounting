import React from 'react';

interface Attachment {
    id: string;
    name?: string;
    size?: string | number;
    [key: string]: unknown;
}

interface InvoiceRecord {
    attachments?: Attachment[];
    [key: string]: unknown;
}

interface InvoiceAttachmentsTabProps {
    invoice: InvoiceRecord;
}

const InvoiceAttachmentsTab: React.FC<InvoiceAttachmentsTabProps> = ({ invoice }) => {
    const attachments = invoice.attachments || [];

    return (
        <div>
            <div className="attachment-actions">
                <button className="h-8 px-3 text-sm font-medium bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-md opacity-50 cursor-not-allowed" disabled>Add File (Placeholder)</button>
            </div>
            <ul className="attachment-list">
                {attachments.length === 0 && (
                    <li className="attachment-empty">No attachments.</li>
                )}
                {attachments.map((file) => (
                    <li key={file.id} className="attachment-item">
                        <span>{file.name}</span>
                        <span>{file.size}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default InvoiceAttachmentsTab;
