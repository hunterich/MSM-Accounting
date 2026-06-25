// src/components/ar/invoices/InvoiceDetailPane.tsx
import React, { useMemo } from 'react';
import InvoiceDetailTabs from './InvoiceDetailTabs';
import { useInvoices } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions, useExtraAction } from '../../../hooks/useModulePermissions';

interface Props { invoiceId: string; workspaceTabId: string }

const InvoiceDetailPane = ({ invoiceId }: Props): React.ReactElement => {
    const { canEdit, canDelete } = useModulePermissions('ar_invoices');
    const canReprint = useExtraAction('ar_invoices', 'reprint');
    const { open } = useWorkspaceNav();
    // Same source as the form/list (invoices API) so a saved invoice is
    // viewable immediately. The detail tabs read line items from the local
    // invoiceItemTemplates store themselves (keyed by invoice id), matching
    // how InvoiceWorkbench wires the detail view.
    const { data: invoicesResult } = useInvoices();
    const invoice = useMemo(
        () => (invoicesResult?.data ?? []).find((inv) => inv.id === invoiceId) ?? null,
        [invoicesResult?.data, invoiceId],
    );

    if (!invoice) return <div className="invoice-workbench-card"><div className="empty-detail">Invoice not found.</div></div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'invoice', recordId: invoiceId, mode: 'edit' },
        title: `Edit ${invoiceId}`,
        path: `/ar/invoices/edit?invoiceId=${invoiceId}`,
    });

    return (
        <InvoiceDetailTabs
            invoice={invoice as unknown as { id: string; [key: string]: unknown }}
            onEdit={openEdit}
            onPrint={() => {}}
            onVoid={() => {}}
            canEdit={canEdit}
            canDelete={canDelete}
            canPrint={canReprint}
            canVoid={canEdit}
        />
    );
};

export default InvoiceDetailPane;
