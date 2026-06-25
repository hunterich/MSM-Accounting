// src/components/ar/salesorders/SODetailPane.tsx
import React, { useEffect } from 'react';
import SODetailTabs from './SODetailTabs';
import { useSalesOrders } from '../../../hooks/useAR';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';

interface Props { soId: string; workspaceTabId: string }

const SODetailPane = ({ soId }: Props): React.ReactElement => {
    const { canEdit } = useModulePermissions('ar_sales_orders');
    const { canCreate: canCreateInvoice } = useModulePermissions('ar_invoices');
    const { open } = useWorkspaceNav();
    const { data: soResult, refetch } = useSalesOrders();

    useEffect(() => { refetch(); }, [soId, refetch]); // freshen on (re)activation

    const so = (soResult?.data ?? []).find((s) => s.id === soId) || null;
    if (!so) return <div className="invoice-workbench-card"><div className="empty-detail">Sales order not found.</div></div>;

    const openEdit = () => open({
        kind: 'doc-form',
        target: { module: 'ar', entity: 'sales-order', recordId: soId, mode: 'edit' },
        title: `Edit ${so.number || soId}`,
        path: `/ar/sales-orders/edit?soId=${soId}`,
    });

    return (
        <SODetailTabs
            salesOrder={so as unknown as Record<string, unknown>}
            lineItems={((so as unknown as { items?: unknown[] }).items ?? []) as Record<string, unknown>[]}
            onEdit={openEdit}
            onPrint={() => {}}
            onConvertToInvoice={() => {}}
            canEdit={canEdit}
            canConvertToInvoice={canCreateInvoice}
        />
    );
};

export default SODetailPane;
