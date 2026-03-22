import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary, PageErrorFallback } from './components/UI/ErrorBoundary'
import Layout from './components/Layout/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ChartOfAccounts from './pages/gl/ChartOfAccounts'
import JournalEntries from './pages/gl/JournalEntries'
import JournalEntryForm from './pages/gl/JournalEntryForm'
import Invoices from './pages/ar/Invoices'
import InvoiceWorkbench from './pages/ar/InvoiceWorkbench'
import InvoiceForm from './pages/ar/InvoiceForm'
import SalesOrderWorkbench from './pages/ar/SalesOrderWorkbench'
import Customers from './pages/ar/Customers'
import CustomerForm from './pages/ar/CustomerForm'
import CustomerCategories from './pages/ar/CustomerCategories'
import Payments from './pages/ar/Payments'
import PaymentForm from './pages/ar/PaymentForm'
import CreditNotes from './pages/ar/CreditNotes'
import CreditNoteForm from './pages/ar/CreditNoteForm'
import SalesReturnForm from './pages/ar/SalesReturnForm'
import SOForm from './components/ar/salesorders/SOForm'

import Bills from './pages/ap/Bills'
import BillForm from './pages/ap/BillForm'
import PurchaseOrders from './pages/ap/PurchaseOrders'
import POForm from './pages/ap/POForm'
import Vendors from './pages/ap/Vendors'
import VendorForm from './pages/ap/VendorForm'
import APPayments from './pages/ap/Payments'
import APPaymentForm from './pages/ap/PaymentForm'
import APDebitNotes from './pages/ap/DebitNotes'
import PurchaseReturnForm from './pages/ap/PurchaseReturnForm'
import DebitNoteForm from './pages/ap/DebitNoteForm'

import Inventory from './pages/inventory/Inventory'
import InventoryForm from './pages/inventory/InventoryForm'
import InventoryAdjustments from './pages/inventory/InventoryAdjustments'
import AdjustmentForm from './pages/inventory/AdjustmentForm'
import Banking from './pages/banking/Banking'
import BankingActionForm from './pages/banking/BankingActionForm'
import Employees from './pages/hr/Employees'
import EmployeeForm from './pages/hr/EmployeeForm'
import Attendance from './pages/hr/Attendance'
import PayrollRun from './pages/hr/PayrollRun'

import Reports from './pages/reports/Reports'
import Settings from './pages/settings/Settings'
import Integrations from './pages/integrations/Integrations'
import CompanySetup from './pages/company/CompanySetup'

function App() {
    return (
        <ErrorBoundary fallback={PageErrorFallback}>
        <Router>
            <Routes>
                <Route path="/login" element={<Login />} />

                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                    <Route index element={<ErrorBoundary fallback={PageErrorFallback}><Dashboard /></ErrorBoundary>} />

                    {/* General Ledger */}
                    <Route path="gl" element={<ChartOfAccounts />} />
                    <Route path="gl/journals" element={<JournalEntries />} />
                    <Route path="gl/journals/new" element={<JournalEntryForm />} />
                    <Route path="gl/journals/edit" element={<JournalEntryForm />} />

                    {/* Accounts Receivable */}
                    <Route path="ar" element={<Navigate to="/ar/sales-orders" replace />} />
                    <Route path="ar/invoices" element={<Invoices />} />
                    <Route path="ar/invoices/workbench" element={<InvoiceWorkbench />} />
                    <Route path="ar/invoices/new" element={<InvoiceForm />} />
                    <Route path="ar/invoices/edit" element={<InvoiceForm />} />
                    <Route path="ar/sales-orders" element={<SalesOrderWorkbench />} />
                    <Route path="ar/sales-orders/new" element={<SOForm mode="create" />} />
                    <Route path="ar/sales-orders/edit" element={<SOForm mode="edit" />} />
                    <Route path="ar/customers" element={<Customers />} />
                    <Route path="ar/customers/new" element={<CustomerForm />} />
                    <Route path="ar/customers/edit" element={<CustomerForm />} />
                    <Route path="ar/categories" element={<CustomerCategories />} />
                    <Route path="ar/payments" element={<Payments />} />
                    <Route path="ar/payments/new" element={<PaymentForm />} />
                    <Route path="ar/payments/edit" element={<PaymentForm />} />
                    <Route path="ar/credits" element={<CreditNotes />} />
                    <Route path="ar/credits/new" element={<CreditNoteForm />} />
                    <Route path="ar/credits/edit" element={<CreditNoteForm />} />
                    <Route path="ar/returns/new" element={<SalesReturnForm />} />

                    {/* Accounts Payable */}
                    <Route path="ap" element={<Navigate to="/ap/bills" replace />} />
                    <Route path="ap/pos" element={<PurchaseOrders />} />
                    <Route path="ap/pos/new" element={<POForm />} />
                    <Route path="ap/pos/edit" element={<POForm />} />
                    <Route path="ap/bills" element={<Bills />} />
                    <Route path="ap/bills/new" element={<BillForm />} />
                    <Route path="ap/bills/edit" element={<BillForm />} />
                    <Route path="ap/payments" element={<APPayments />} />
                    <Route path="ap/payments/new" element={<APPaymentForm />} />
                    <Route path="ap/payments/edit" element={<APPaymentForm />} />
                    <Route path="ap/debits" element={<APDebitNotes />} />
                    <Route path="ap/returns/new" element={<PurchaseReturnForm />} />
                    <Route path="ap/debits/new" element={<DebitNoteForm />} />
                    <Route path="ap/debits/edit" element={<DebitNoteForm />} />
                    <Route path="ap/vendors" element={<Vendors />} />
                    <Route path="ap/vendors/new" element={<VendorForm />} />
                    <Route path="ap/vendors/edit" element={<VendorForm />} />

                    {/* Inventory */}
                    <Route path="inventory" element={<Navigate to="/inventory/items" replace />} />
                    <Route path="inventory/items" element={<Inventory />} />
                    <Route path="inventory/new" element={<InventoryForm />} />
                    <Route path="inventory/adjustments" element={<InventoryAdjustments />} />
                    <Route path="inventory/adjustments/new" element={<AdjustmentForm />} />
                    <Route path="inventory/adjustments/edit" element={<AdjustmentForm />} />

                    {/* Banking */}
                    <Route path="banking" element={<Banking />} />
                    <Route path="banking/transfer" element={<BankingActionForm />} />
                    <Route path="banking/expense" element={<BankingActionForm />} />
                    <Route path="banking/income" element={<BankingActionForm />} />
                    <Route path="banking/account" element={<BankingActionForm />} />

                    {/* HR & Payroll */}
                    <Route path="hr" element={<Navigate to="/hr/employees" replace />} />
                    <Route path="hr/employees" element={<Employees />} />
                    <Route path="hr/employees/new" element={<EmployeeForm />} />
                    <Route path="hr/employees/edit" element={<EmployeeForm />} />
                    <Route path="hr/attendance" element={<Attendance />} />
                    <Route path="hr/payroll-run" element={<PayrollRun />} />

                    <Route path="integrations" element={<Integrations />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="company-setup" element={<CompanySetup />} />
                    <Route path="settings" element={<Settings />} />
                </Route>
            </Routes>
        </Router>
        </ErrorBoundary>
    )
}

export default App
