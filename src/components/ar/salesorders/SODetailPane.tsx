// src/components/ar/salesorders/SODetailPane.tsx
import React from 'react';
import SODetailTabs from './SODetailTabs';
import { useSalesOrder } from '../../../hooks/useAR';
import { toSalesOrderView } from '../../../lib/salesOrderView';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface Props { soId: string; workspaceTabId: string }

const SODetailPane = ({ soId }: Props): React.ReactElement => {
    const { canEdit } = useModulePermissions('ar_sales_orders');
    const { canCreate: canCreateInvoice } = useModulePermissions('ar_invoices');
    const { open } = useWorkspaceNav();
    // Same source as the form and the list — the sales orders API. All three
    // used to disagree: the form saved to the API while these panes read a
    // browser-local store of fixtures.
    const { data: raw, isLoading } = useSalesOrder(soId);
    const so = raw ? toSalesOrderView(raw) : null;

    if (isLoading) return <div className="invoice-workbench-card"><div className="empty-detail">Loading sales order…</div></div>;
    if (!so) return <div className="invoice-workbench-card"><div className="empty-detail">Sales order not found.</div></div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
        title: `Edit ${so.no}`,
        path: `/ar/sales-orders/edit?soId=${soId}`,
    });

    return (
        <SODetailTabs
            salesOrder={so as unknown as Record<string, unknown>}
            lineItems={so.items as unknown as Record<string, unknown>[]}
            onEdit={openEdit}
            onPrint={() => {}}
            onConvertToInvoice={() => {}}
            canEdit={canEdit}
            canConvertToInvoice={canCreateInvoice}
        />
    );
};

export default SODetailPane;
