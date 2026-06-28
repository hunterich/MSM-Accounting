// src/components/workspace/tabRegistry.tsx
import React from 'react';
import type { WorkspaceTab } from '../../stores/workspace/types';
import SOFormV2 from '../ar/salesorders/SOFormV2';
import SalesOrderListPane from '../ar/salesorders/SalesOrderListPane';
import SODetailPane from '../ar/salesorders/SODetailPane';
import InvoiceForm from '../../views/ar/InvoiceForm';
import InvoiceListPane from '../ar/invoices/InvoiceListPane';
import InvoiceDetailPane from '../ar/invoices/InvoiceDetailPane';
import CustomerListPane from '../ar/customers/CustomerListPane';
import CustomerDetailPane from '../ar/customers/CustomerDetailPane';
import CustomerForm from '../../views/ar/CustomerForm';
import PaymentListPane from '../ar/payments/PaymentListPane';
import PaymentDetailPane from '../ar/payments/PaymentDetailPane';
import PaymentForm from '../../views/ar/PaymentForm';
import StockCountListPane from '../inventory/stockcounts/StockCountListPane';
import StockCountDetailPane from '../inventory/stockcounts/StockCountDetailPane';
import StockCountForm from '../../views/inventory/StockCountForm';

/** Renders the body for a tab. Extended per-entity as modules are wired in. */
export function renderTab(tab: WorkspaceTab): React.ReactNode {
    const { module, entity, mode, recordId } = tab.target;

    if (module === 'ar' && entity === 'sales-order') {
        if (tab.kind === 'list') return <SalesOrderListPane />;
        if (tab.kind === 'doc-form') {
            return <SOFormV2 mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} recordId={recordId ?? undefined} />;
        }
        if (tab.kind === 'doc-view') return <SODetailPane soId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    if (module === 'ar' && entity === 'invoice') {
        if (tab.kind === 'list') return <InvoiceListPane />;
        if (tab.kind === 'doc-form') {
            return <InvoiceForm mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} recordId={recordId ?? undefined} />;
        }
        if (tab.kind === 'doc-view') return <InvoiceDetailPane invoiceId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    if (module === 'ar' && entity === 'customer') {
        if (tab.kind === 'list') return <CustomerListPane />;
        if (tab.kind === 'doc-form') return <CustomerForm recordId={recordId ?? undefined} mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-view') return <CustomerDetailPane customerId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    if (module === 'ar' && entity === 'payment') {
        if (tab.kind === 'list') return <PaymentListPane />;
        if (tab.kind === 'doc-form') return <PaymentForm recordId={recordId ?? undefined} mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-view') return <PaymentDetailPane paymentId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    if (module === 'stock-count' && entity === 'count') {
        if (tab.kind === 'list') return <StockCountListPane />;
        if (tab.kind === 'doc-form') return <StockCountForm recordId={recordId ?? undefined} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-view') return <StockCountDetailPane countId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for "{module}/{entity}" yet.</div>
        </div>
    );
}
