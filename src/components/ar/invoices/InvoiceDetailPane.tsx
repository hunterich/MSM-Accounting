// src/components/ar/invoices/InvoiceDetailPane.tsx
import React, { useState } from 'react';
import InvoiceDetailTabs from './InvoiceDetailTabs';
import InvoicePrintPreview from './InvoicePrintPreview';
import { useInvoice } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions, useExtraAction } from '../../../hooks/useModulePermissions';

interface Props { invoiceId: string; workspaceTabId: string }

const InvoiceDetailPane = ({ invoiceId }: Props): React.ReactElement => {
    const { canEdit, canDelete } = useModulePermissions('ar_invoices');
    const canReprint = useExtraAction('ar_invoices', 'reprint');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const { open } = useWorkspaceNav();
    const { data: invoice, isLoading, error } = useInvoice(invoiceId);

    if (!invoice) return <div className="invoice-workbench-card"><div className="empty-detail">
        {isLoading ? 'Loading invoice...' : error ? `Could not load invoice: ${error.message}` : 'Invoice not found.'}
    </div></div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'edit' },
        title: `Edit ${invoiceId}`,
        path: `/ar/invoices/edit?invoiceId=${invoiceId}`,
    });

    return (
        <>
            <InvoiceDetailTabs
                invoice={invoice as unknown as { id: string; [key: string]: unknown }}
                onEdit={openEdit}
                onPrint={() => setIsPrintOpen(true)}
                onVoid={() => {}}
                canEdit={canEdit}
                canDelete={canDelete}
                canPrint={canReprint}
                canVoid={canEdit}
            />
            <InvoicePrintPreview invoiceId={isPrintOpen ? invoiceId : null} onClose={() => setIsPrintOpen(false)} />
        </>
    );
};

export default InvoiceDetailPane;
