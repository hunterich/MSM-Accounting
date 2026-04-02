import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary, PageErrorFallback } from './components/UI/ErrorBoundary'
import Layout from './components/Layout/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import PermissionRoute from './components/auth/PermissionRoute'
import Login from './views/Login'
import Forbidden from './views/Forbidden'
import Dashboard from './views/Dashboard'
import ChartOfAccounts from './views/gl/ChartOfAccounts'
import JournalEntries from './views/gl/JournalEntries'
import JournalEntryForm from './views/gl/JournalEntryForm'
import Invoices from './views/ar/Invoices'
import InvoiceWorkbench from './views/ar/InvoiceWorkbench'
import InvoiceForm from './views/ar/InvoiceForm'
import SalesOrderWorkbench from './views/ar/SalesOrderWorkbench'
import Customers from './views/ar/Customers'
import CustomerForm from './views/ar/CustomerForm'
import CustomerCategories from './views/ar/CustomerCategories'
import Payments from './views/ar/Payments'
import PaymentForm from './views/ar/PaymentForm'
import CreditNotes from './views/ar/CreditNotes'
import CreditNoteForm from './views/ar/CreditNoteForm'
import SalesReturnForm from './views/ar/SalesReturnForm'
import SOForm from './components/ar/salesorders/SOForm'

import Bills from './views/ap/Bills'
import BillForm from './views/ap/BillForm'
import PurchaseOrders from './views/ap/PurchaseOrders'
import POForm from './views/ap/POForm'
import Vendors from './views/ap/Vendors'
import VendorCategories from './views/ap/VendorCategories'
import VendorForm from './views/ap/VendorForm'
import APPayments from './views/ap/Payments'
import APPaymentForm from './views/ap/PaymentForm'
import APDebitNotes from './views/ap/DebitNotes'
import PurchaseReturnForm from './views/ap/PurchaseReturnForm'
import DebitNoteForm from './views/ap/DebitNoteForm'

import Inventory from './views/inventory/Inventory'
import InventoryForm from './views/inventory/InventoryForm'
import ItemCategories from './views/inventory/ItemCategories'
import InventoryAdjustments from './views/inventory/InventoryAdjustments'
import AdjustmentForm from './views/inventory/AdjustmentForm'
import Banking from './views/banking/Banking'
import BankingActionForm from './views/banking/BankingActionForm'
import Employees from './views/hr/Employees'
import EmployeeForm from './views/hr/EmployeeForm'
import Attendance from './views/hr/Attendance'
import PayrollRun from './views/hr/PayrollRun'

import Reports from './views/reports/Reports'
import Settings from './views/settings/Settings'
import Integrations from './views/integrations/Integrations'
import CompanySetup from './views/company/CompanySetup'

function App() {
    const withPermission = (element, moduleKey, action = 'view') => (
        <PermissionRoute moduleKey={moduleKey} action={action}>
            {element}
        </PermissionRoute>
    )

    return (
        <ErrorBoundary fallback={PageErrorFallback}>
        <Router>
            <Routes>
                <Route path="/login" element={<Login />} />

                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                    <Route path="403" element={<Forbidden />} />
                    <Route
                        index
                        element={withPermission(
                            <ErrorBoundary fallback={PageErrorFallback}><Dashboard /></ErrorBoundary>,
                            'dashboard'
                        )}
                    />

                    {/* General Ledger */}
                    <Route path="gl" element={withPermission(<ChartOfAccounts />, 'gl_coa')} />
                    <Route path="gl/journals" element={withPermission(<JournalEntries />, 'gl_journal')} />
                    <Route path="gl/journals/new" element={withPermission(<JournalEntryForm />, 'gl_journal', 'create')} />
                    <Route path="gl/journals/edit" element={withPermission(<JournalEntryForm />, 'gl_journal', 'edit')} />

                    {/* Accounts Receivable */}
                    <Route path="ar" element={<Navigate to="/ar/sales-orders" replace />} />
                    <Route path="ar/invoices" element={withPermission(<Invoices />, 'ar_invoices')} />
                    <Route path="ar/invoices/workbench" element={withPermission(<InvoiceWorkbench />, 'ar_invoices')} />
                    <Route path="ar/invoices/new" element={withPermission(<InvoiceForm />, 'ar_invoices', 'create')} />
                    <Route path="ar/invoices/edit" element={withPermission(<InvoiceForm />, 'ar_invoices', 'edit')} />
                    <Route path="ar/sales-orders" element={withPermission(<SalesOrderWorkbench />, 'ar_sales_orders')} />
                    <Route path="ar/sales-orders/new" element={withPermission(<SOForm mode="create" />, 'ar_sales_orders', 'create')} />
                    <Route path="ar/sales-orders/edit" element={withPermission(<SOForm mode="edit" />, 'ar_sales_orders', 'edit')} />
                    <Route path="ar/customers" element={withPermission(<Customers />, 'ar_customers')} />
                    <Route path="ar/customers/new" element={withPermission(<CustomerForm />, 'ar_customers', 'create')} />
                    <Route path="ar/customers/edit" element={withPermission(<CustomerForm />, 'ar_customers', 'edit')} />
                    <Route path="ar/categories" element={withPermission(<CustomerCategories />, 'ar_customers')} />
                    <Route path="ar/payments" element={withPermission(<Payments />, 'ar_payments')} />
                    <Route path="ar/payments/new" element={withPermission(<PaymentForm />, 'ar_payments', 'create')} />
                    <Route path="ar/payments/edit" element={withPermission(<PaymentForm />, 'ar_payments', 'edit')} />
                    <Route path="ar/credits" element={withPermission(<CreditNotes />, 'ar_credits')} />
                    <Route path="ar/credits/new" element={withPermission(<CreditNoteForm />, 'ar_credits', 'create')} />
                    <Route path="ar/credits/edit" element={withPermission(<CreditNoteForm />, 'ar_credits', 'edit')} />
                    <Route path="ar/returns/new" element={withPermission(<SalesReturnForm />, 'ar_credits', 'create')} />

                    {/* Accounts Payable */}
                    <Route path="ap" element={<Navigate to="/ap/bills" replace />} />
                    <Route path="ap/pos" element={withPermission(<PurchaseOrders />, 'ap_pos')} />
                    <Route path="ap/pos/new" element={withPermission(<POForm />, 'ap_pos', 'create')} />
                    <Route path="ap/pos/edit" element={withPermission(<POForm />, 'ap_pos', 'edit')} />
                    <Route path="ap/bills" element={withPermission(<Bills />, 'ap_bills')} />
                    <Route path="ap/bills/new" element={withPermission(<BillForm />, 'ap_bills', 'create')} />
                    <Route path="ap/bills/edit" element={withPermission(<BillForm />, 'ap_bills', 'edit')} />
                    <Route path="ap/payments" element={withPermission(<APPayments />, 'ap_payments')} />
                    <Route path="ap/payments/new" element={withPermission(<APPaymentForm />, 'ap_payments', 'create')} />
                    <Route path="ap/payments/edit" element={withPermission(<APPaymentForm />, 'ap_payments', 'edit')} />
                    <Route path="ap/debits" element={withPermission(<APDebitNotes />, 'ap_debits')} />
                    <Route path="ap/returns/new" element={withPermission(<PurchaseReturnForm />, 'ap_debits', 'create')} />
                    <Route path="ap/debits/new" element={withPermission(<DebitNoteForm />, 'ap_debits', 'create')} />
                    <Route path="ap/debits/edit" element={withPermission(<DebitNoteForm />, 'ap_debits', 'edit')} />
                    <Route path="ap/vendors" element={withPermission(<Vendors />, 'ap_vendors')} />
                    <Route path="ap/vendor-categories" element={withPermission(<VendorCategories />, 'ap_vendors')} />
                    <Route path="ap/vendors/new" element={withPermission(<VendorForm />, 'ap_vendors', 'create')} />
                    <Route path="ap/vendors/edit" element={withPermission(<VendorForm />, 'ap_vendors', 'edit')} />

                    {/* Inventory */}
                    <Route path="inventory" element={<Navigate to="/inventory/items" replace />} />
                    <Route path="inventory/items" element={withPermission(<Inventory />, 'inv_items')} />
                    <Route path="inventory/new" element={withPermission(<InventoryForm />, 'inv_items', 'create')} />
                    <Route path="inventory/categories" element={withPermission(<ItemCategories />, 'inv_categories')} />
                    <Route path="inventory/adjustments" element={withPermission(<InventoryAdjustments />, 'inv_adj')} />
                    <Route path="inventory/adjustments/new" element={withPermission(<AdjustmentForm />, 'inv_adj', 'create')} />
                    <Route path="inventory/adjustments/edit" element={withPermission(<AdjustmentForm />, 'inv_adj', 'edit')} />

                    {/* Banking */}
                    <Route path="banking" element={withPermission(<Banking />, 'banking')} />
                    <Route path="banking/transfer" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/expense" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/income" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/account" element={withPermission(<BankingActionForm />, 'banking', 'create')} />

                    {/* HR & Payroll */}
                    <Route path="hr" element={<Navigate to="/hr/employees" replace />} />
                    <Route path="hr/employees" element={withPermission(<Employees />, 'hr_employees')} />
                    <Route path="hr/employees/new" element={withPermission(<EmployeeForm />, 'hr_employees', 'create')} />
                    <Route path="hr/employees/edit" element={withPermission(<EmployeeForm />, 'hr_employees', 'edit')} />
                    <Route path="hr/attendance" element={withPermission(<Attendance />, 'hr_attendance')} />
                    <Route path="hr/payroll-run" element={withPermission(<PayrollRun />, 'hr_payroll')} />

                    <Route path="integrations" element={withPermission(<Integrations />, 'integrations')} />
                    <Route path="reports" element={withPermission(<Reports />, 'reports')} />
                    <Route path="company-setup" element={withPermission(<CompanySetup />, 'company')} />
                    <Route path="settings" element={withPermission(<Settings />, 'settings')} />
                </Route>
            </Routes>
        </Router>
        </ErrorBoundary>
    )
}

export default App
