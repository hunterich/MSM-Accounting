// src/components/ar/salesorders/SODetailPane.tsx
import React from 'react';
import SODetailTabs from './SODetailTabs';
import { useSalesOrderStore } from '../../../stores/useSalesOrderStore';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface Props { soId: string; workspaceTabId: string }

const SODetailPane = ({ soId }: Props): React.ReactElement => {
    const { canEdit } = useModulePermissions('ar_sales_orders');
    const { canCreate: canCreateInvoice } = useModulePermissions('ar_invoices');
    const { open } = useWorkspaceNav();
    // Same source as the form/list so a saved order is viewable immediately.
    const so = useSalesOrderStore((s) => s.salesOrders.find((o) => o.id === soId)) ?? null;
    const lineItems = useSalesOrderStore((s) => s.soItemTemplates[soId]) ?? [];

    if (!so) return <div className="invoice-workbench-card"><div className="empty-detail">Sales order not found.</div></div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
        title: `Edit ${soId}`,
        path: `/ar/sales-orders/edit?soId=${soId}`,
    });

    return (
        <SODetailTabs
            salesOrder={so as unknown as Record<string, unknown>}
            lineItems={lineItems as unknown as Record<string, unknown>[]}
            onEdit={openEdit}
            onPrint={() => {}}
            onConvertToInvoice={() => {}}
            canEdit={canEdit}
            canConvertToInvoice={canCreateInvoice}
        />
    );
};

export default SODetailPane;
