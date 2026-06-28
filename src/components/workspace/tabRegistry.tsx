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
import CreditNoteListPane from '../ar/credits/CreditNoteListPane';
import CreditNoteDetailPane from '../ar/credits/CreditNoteDetailPane';
import CreditNoteForm from '../../views/ar/CreditNoteForm';
import SalesReturnForm from '../../views/ar/SalesReturnForm';
import BankingListPane from '../banking/BankingListPane';
import BankingDetailPane from '../banking/BankingDetailPane';
import BankingActionForm from '../../views/banking/BankingActionForm';
import POListPane from '../ap/purchaseorders/POListPane';
import POFormV2 from '../ap/forms/POFormV2';
import BillListPane from '../ap/bills/BillListPane';
import BillFormV2 from '../ap/forms/BillFormV2';
import APPaymentListPane from '../ap/payments/APPaymentListPane';
import APPaymentDetailPane from '../ap/payments/APPaymentDetailPane';
import APPaymentForm from '../../views/ap/PaymentForm';

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

    if (module === 'ap' && entity === 'purchase-order') {
        if (tab.kind === 'list') return <POListPane />;
        // POs have no separate detail — View/Edit both open the (editable) form.
        if (tab.kind === 'doc-form' || tab.kind === 'doc-view') {
            return <POFormV2 mode={recordId ? 'edit' : 'create'} recordId={recordId ?? undefined} workspaceTabId={tab.id} />;
        }
    }

    if (module === 'ap' && entity === 'payment') {
        if (tab.kind === 'list') return <APPaymentListPane />;
        if (tab.kind === 'doc-form') return <APPaymentForm recordId={recordId ?? undefined} mode={mode === 'edit' ? 'edit' : 'create'} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-view') return <APPaymentDetailPane paymentId={recordId ?? ''} workspaceTabId={tab.id} />;
    }

    if (module === 'ap' && entity === 'bill') {
        if (tab.kind === 'list') return <BillListPane />;
        if (tab.kind === 'doc-form' || tab.kind === 'doc-view') {
            return <BillFormV2 mode={recordId ? 'edit' : 'create'} recordId={recordId ?? undefined} workspaceTabId={tab.id} />;
        }
    }

    if (module === 'banking' && entity === 'transaction') {
        if (tab.kind === 'list') return <BankingListPane />;
        if (tab.kind === 'doc-view') return <BankingDetailPane txnId={recordId ?? ''} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-form') {
            const rid = recordId ?? '';
            if (rid.startsWith('edit:')) {
                const [, action, ...idParts] = rid.split(':');
                return <BankingActionForm action={action as 'expense' | 'income' | 'transfer' | 'account'} sourceTransactionId={idParts.join(':')} workspaceTabId={tab.id} />;
            }
            const action = (rid.startsWith('new:') ? rid.slice('new:'.length) : 'expense') as 'expense' | 'income' | 'transfer' | 'account';
            return <BankingActionForm action={action} workspaceTabId={tab.id} />;
        }
    }

    if (module === 'ar' && entity === 'credit-note') {
        if (tab.kind === 'list') return <CreditNoteListPane />;
        if (tab.kind === 'doc-view') return <CreditNoteDetailPane docKey={recordId ?? ''} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-form') {
            const rid = recordId ?? '';
            if (rid.startsWith('credit:')) return <CreditNoteForm recordId={rid.slice('credit:'.length)} mode="edit" workspaceTabId={tab.id} />;
            const returnId = rid.startsWith('return:') ? rid.slice('return:'.length) : undefined;
            return <SalesReturnForm recordId={returnId} mode={returnId ? 'edit' : 'create'} workspaceTabId={tab.id} />;
        }
    }

    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for "{module}/{entity}" yet.</div>
        </div>
    );
}
