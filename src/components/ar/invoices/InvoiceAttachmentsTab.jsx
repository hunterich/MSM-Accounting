import React from 'react';

const InvoiceAttachmentsTab = ({ invoice }) => {
    const attachments = invoice.attachments || [];

    return (
        <div>
            <div className="mb-3">
                <button className="h-8 px-3 text-sm font-medium bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-md opacity-50 cursor-not-allowed" disabled>Add File (Placeholder)</button>
            </div>
            <ul className="list-none m-0 p-0">
                {attachments.length === 0 && (
                    <li className="text-neutral-600 text-[0.9rem]">No attachments.</li>
                )}
                {attachments.map((file) => (
                    <li key={file.id} className="border border-neutral-200 rounded-lg py-2 px-2.5 mb-2 flex justify-between">
                        <span>{file.name}</span>
                        <span>{file.size}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default InvoiceAttachmentsTab;
