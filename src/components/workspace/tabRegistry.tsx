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
import VendorListPane from '../ap/vendors/VendorListPane';
import VendorForm from '../../views/ap/VendorForm';
import DeliveryNoteListPane from '../ar/deliverynotes/DeliveryNoteListPane';
import DeliveryNoteForm from '../ar/deliverynotes/DeliveryNoteForm';
import APDebitNoteListPane from '../ap/debits/APDebitNoteListPane';
import APDebitNoteDetailPane from '../ap/debits/APDebitNoteDetailPane';
import DebitNoteForm from '../../views/ap/DebitNoteForm';
import PurchaseReturnForm from '../../views/ap/PurchaseReturnForm';
import ReportsCatalogTab from './ReportsCatalogTab';
import ReportsReportTab from './ReportsReportTab';

/**
 * View permission required to render a tab, keyed by `module/entity`. These are
 * the same module keys the router used to enforce via `withPermission`; the
 * workspace renders document tabs from this registry rather than through the
 * router, so the check lives here instead.
 */
const TAB_VIEW_PERMISSION: Record<string, string> = {
    'ar/sales-order': 'ar_sales_orders',
    'ar/invoice': 'ar_invoices',
    'ar/customer': 'ar_customers',
    'ar/payment': 'ar_payments',
    'ar/credit-note': 'ar_credits',
    'ar/delivery-note': 'ar_sales_orders',
    'stock-count/count': 'inv_adj',
    'banking/transaction': 'banking',
    'ap/purchase-order': 'ap_pos',
    'ap/bill': 'ap_bills',
    'ap/payment': 'ap_payments',
    'ap/vendor': 'ap_vendors',
    'ap/debit-note': 'ap_debits',
};

/** The module key a tab needs 'view' on, or null when the router still gates it. */
export function tabViewPermission(tab: WorkspaceTab): string | null {
    const { module, entity } = tab.target;
    if (module === 'page') return null; // rendered through <Outlet/>, still router-gated
    if (module === 'reports') return 'reports';
    return TAB_VIEW_PERMISSION[`${module}/${entity}`] ?? null;
}

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

    if (module === 'ap' && entity === 'debit-note') {
        if (tab.kind === 'list') return <APDebitNoteListPane />;
        if (tab.kind === 'doc-view') return <APDebitNoteDetailPane docKey={recordId ?? ''} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-form') {
            const rid = recordId ?? '';
            // Seeded from a just-saved purchase return: no record yet, the
            // prefill lives in this tab's draft.
            if (rid.startsWith('new-debit:')) return <DebitNoteForm mode="create" workspaceTabId={tab.id} />;
            if (rid.startsWith('debit:')) return <DebitNoteForm recordId={rid.slice('debit:'.length)} mode="edit" workspaceTabId={tab.id} />;
            const returnId = rid.startsWith('return:') ? rid.slice('return:'.length) : undefined;
            return <PurchaseReturnForm recordId={returnId} mode={returnId ? 'edit' : 'create'} workspaceTabId={tab.id} />;
        }
    }

    if (module === 'ap' && entity === 'vendor') {
        if (tab.kind === 'list') return <VendorListPane />;
        if (tab.kind === 'doc-form' || tab.kind === 'doc-view') {
            return <VendorForm recordId={recordId ?? undefined} mode={mode === 'edit' ? 'edit' : mode === 'view' ? 'view' : 'create'} workspaceTabId={tab.id} />;
        }
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

    if (module === 'ar' && entity === 'delivery-note') {
        if (tab.kind === 'list') return <DeliveryNoteListPane />;
        if (tab.kind === 'doc-form') return <DeliveryNoteForm workspaceTabId={tab.id} />;
    }

    if (module === 'ar' && entity === 'credit-note') {
        if (tab.kind === 'list') return <CreditNoteListPane />;
        if (tab.kind === 'doc-view') return <CreditNoteDetailPane docKey={recordId ?? ''} workspaceTabId={tab.id} />;
        if (tab.kind === 'doc-form') {
            const rid = recordId ?? '';
            // Seeded from a just-saved sales return: no record yet, the prefill
            // lives in this tab's draft.
            if (rid.startsWith('new-credit:')) return <CreditNoteForm mode="create" workspaceTabId={tab.id} />;
            if (rid.startsWith('credit:')) return <CreditNoteForm recordId={rid.slice('credit:'.length)} mode="edit" workspaceTabId={tab.id} />;
            const returnId = rid.startsWith('return:') ? rid.slice('return:'.length) : undefined;
            return <SalesReturnForm recordId={returnId} mode={returnId ? 'edit' : 'create'} workspaceTabId={tab.id} />;
        }
    }

    if (module === 'reports') {
        if (tab.kind === 'list') return <ReportsCatalogTab />;
        if (tab.kind === 'report') return <ReportsReportTab tabId={tab.id} />;
    }

    return (
        <div className="p-6 text-sm text-neutral-500">
            <div className="font-medium text-neutral-700">{tab.title}</div>
            <div>No renderer registered for "{module}/{entity}" yet.</div>
        </div>
    );
}
