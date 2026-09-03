import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary, PageErrorFallback } from './components/UI/ErrorBoundary'
import Layout from './components/Layout/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import PermissionRoute from './components/auth/PermissionRoute'
import Login from './views/Login'
import Forbidden from './views/Forbidden'
import { TableSkeleton } from './components/UI/LoadingSkeleton'
import type { JSX } from 'react'

const Dashboard = lazy(() => import('./views/Dashboard'))
const ChartOfAccounts = lazy(() => import('./views/gl/ChartOfAccounts'))
const JournalEntries = lazy(() => import('./views/gl/JournalEntries'))
const JournalEntryForm = lazy(() => import('./views/gl/JournalEntryForm'))
const CustomerForm = lazy(() => import('./views/ar/CustomerForm'))
const CustomerCategories = lazy(() => import('./views/ar/CustomerCategories'))
const PaymentForm = lazy(() => import('./views/ar/PaymentForm'))
const CreditNoteForm = lazy(() => import('./views/ar/CreditNoteForm'))
const SalesReturnForm = lazy(() => import('./views/ar/SalesReturnForm'))
const RecurringBilling = lazy(() => import('./views/ar/RecurringBilling'))
const ApprovalInbox = lazy(() => import('./views/ar/ApprovalInbox'))
const SOForm = lazy(() => import('./components/ar/salesorders/SOFormV2'))

const BillImport = lazy(() => import('./views/ap/BillImport'))
const PurchaseOrders = lazy(() => import('./views/ap/PurchaseOrders'))
const POFormV2 = lazy(() => import('./components/ap/forms/POFormV2'))
const BillFormV2 = lazy(() => import('./components/ap/forms/BillFormV2'))
const VendorCategories = lazy(() => import('./views/ap/VendorCategories'))
const VendorForm = lazy(() => import('./views/ap/VendorForm'))
const APPaymentForm = lazy(() => import('./views/ap/PaymentForm'))
const RecurringExpenses = lazy(() => import('./views/ap/RecurringExpenses'))
const PurchaseReturnForm = lazy(() => import('./views/ap/PurchaseReturnForm'))
const DebitNoteForm = lazy(() => import('./views/ap/DebitNoteForm'))

const Inventory = lazy(() => import('./views/inventory/Inventory'))
const InventoryForm = lazy(() => import('./views/inventory/InventoryForm'))
const ItemCategories = lazy(() => import('./views/inventory/ItemCategories'))
const InventoryAdjustments = lazy(() => import('./views/inventory/InventoryAdjustments'))
const AdjustmentForm = lazy(() => import('./views/inventory/AdjustmentForm'))
const StockValuation = lazy(() => import('./views/inventory/StockValuation'))
const StockCountForm = lazy(() => import('./views/inventory/StockCountForm'))
const ModifierSettings = lazy(() => import('./views/pos/ModifierSettings'))
const SalesTypeSettings = lazy(() => import('./views/pos/SalesTypeSettings'))
const BankingActionForm = lazy(() => import('./views/banking/BankingActionForm'))
const PaymentReconciliation = lazy(() => import('./views/banking/PaymentReconciliation'))
const Employees = lazy(() => import('./views/hr/Employees'))
const EmployeeForm = lazy(() => import('./views/hr/EmployeeForm'))
const Attendance = lazy(() => import('./views/hr/Attendance'))
const PayrollRun = lazy(() => import('./views/hr/PayrollRun'))
const LeaveManagement = lazy(() => import('./views/hr/LeaveManagement'))

const AssetRegister = lazy(() => import('./views/assets/AssetRegister'))
const AssetCategories = lazy(() => import('./views/assets/AssetCategories'))
const AssetForm = lazy(() => import('./views/assets/AssetForm'))
const AssetDetail = lazy(() => import('./views/assets/AssetDetail'))
const DepreciationRun = lazy(() => import('./views/assets/DepreciationRun'))

const Reports = lazy(() => import('./views/reports/Reports'))
const BankReconciliation = lazy(() => import('./views/reports/BankReconciliation'))
const SalesPerformance = lazy(() => import('./views/reports/SalesPerformance'))
const SalesByType = lazy(() => import('./views/reports/SalesByType'))
const Settings = lazy(() => import('./views/settings/Settings'))
const DataTools = lazy(() => import('./views/tools/DataTools'))
const UsersAndRoles = lazy(() => import('./views/users/UsersAndRoles'))
const Integrations = lazy(() => import('./views/integrations/Integrations'))
const CompanySetup = lazy(() => import('./views/company/CompanySetup'))

const PageFallback = (): JSX.Element => (
    <div className="p-6">
        <TableSkeleton rowCount={8} />
    </div>
)

/**
 * Placeholder element for document-module list paths. The workspace renders
 * these from the tab registry (see components/workspace/tabRegistry.tsx), not
 * through <Outlet/> — but the path must still be registered or React Router
 * matches nothing and the parent Layout route stops rendering.
 */
const WorkspaceTabRoute = (): null => null

function App(): JSX.Element {
    const withPermission = (element: JSX.Element, moduleKey: string, action = 'view') => (
        <PermissionRoute moduleKey={moduleKey} action={action}>
            {element}
        </PermissionRoute>
    )

    return (
        <ErrorBoundary fallback={PageErrorFallback}>
        <Router>
            <Suspense fallback={<PageFallback />}>
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
                    <Route path="ar/invoices" element={<WorkspaceTabRoute />} />
                    <Route path="ar/invoices/new" element={<WorkspaceTabRoute />} />
                    <Route path="ar/invoices/edit" element={<WorkspaceTabRoute />} />
                    <Route path="ar/invoices/workbench" element={<WorkspaceTabRoute />} />
                    <Route path="ar/sales-orders" element={<WorkspaceTabRoute />} />
                    <Route path="ar/customers" element={<WorkspaceTabRoute />} />
                    <Route path="ar/payments" element={<WorkspaceTabRoute />} />
                    <Route path="ar/delivery-notes" element={<WorkspaceTabRoute />} />
                    <Route path="ar/delivery-notes/new" element={<WorkspaceTabRoute />} />
                    <Route path="ar/credits" element={<WorkspaceTabRoute />} />
                    <Route path="ap/pos" element={<WorkspaceTabRoute />} />
                    <Route path="ap/bills" element={<WorkspaceTabRoute />} />
                    <Route path="ap/payments" element={<WorkspaceTabRoute />} />
                    <Route path="ap/debits" element={<WorkspaceTabRoute />} />
                    <Route path="ap/vendors" element={<WorkspaceTabRoute />} />
                    <Route path="banking" element={<WorkspaceTabRoute />} />
                    <Route path="inventory/counts" element={<WorkspaceTabRoute />} />
                    <Route path="ar" element={<Navigate to="/ar/sales-orders" replace />} />
                    <Route path="ar/sales-orders/new" element={withPermission(<SOForm mode="create" />, 'ar_sales_orders', 'create')} />
                    <Route path="ar/sales-orders/edit" element={withPermission(<SOForm mode="edit" />, 'ar_sales_orders', 'edit')} />
                    <Route path="ar/customers/new" element={withPermission(<CustomerForm />, 'ar_customers', 'create')} />
                    <Route path="ar/customers/edit" element={withPermission(<CustomerForm />, 'ar_customers', 'edit')} />
                    <Route path="ar/categories" element={withPermission(<CustomerCategories />, 'ar_customers')} />
                    <Route path="ar/payments/new" element={withPermission(<PaymentForm />, 'ar_payments', 'create')} />
                    <Route path="ar/payments/edit" element={withPermission(<PaymentForm />, 'ar_payments', 'edit')} />
                    <Route path="ar/credits/new" element={withPermission(<CreditNoteForm />, 'ar_credits', 'create')} />
                    <Route path="ar/credits/edit" element={withPermission(<CreditNoteForm />, 'ar_credits', 'edit')} />
                    <Route path="ar/returns/new" element={withPermission(<SalesReturnForm />, 'ar_credits', 'create')} />
                    <Route path="ar/recurring" element={withPermission(<RecurringBilling />, 'ar_invoices')} />
                    <Route path="ar/approvals" element={withPermission(<ApprovalInbox />, 'ar_invoices')} />
                    <Route path="ar/subscriptions" element={<Navigate to="/ar/recurring?tab=subscriptions" replace />} />

                    {/* Accounts Payable */}
                    <Route path="ap" element={<Navigate to="/ap/bills" replace />} />
                    <Route path="ap/pos/new" element={withPermission(<POFormV2 mode="create" />, 'ap_pos', 'create')} />
                    <Route path="ap/pos/edit" element={withPermission(<POFormV2 mode="edit" />, 'ap_pos', 'edit')} />
                    <Route path="ap/receiving" element={withPermission(<PurchaseOrders receivingMode />, 'ap_pos')} />
                    <Route path="ap/bills/import" element={withPermission(<BillImport />, 'ap_bills', 'create')} />
                    <Route path="ap/bills/new" element={withPermission(<BillFormV2 mode="create" />, 'ap_bills', 'create')} />
                    <Route path="ap/bills/edit" element={withPermission(<BillFormV2 mode="edit" />, 'ap_bills', 'edit')} />
                    <Route path="ap/payments/new" element={withPermission(<APPaymentForm />, 'ap_payments', 'create')} />
                    <Route path="ap/payments/edit" element={withPermission(<APPaymentForm />, 'ap_payments', 'edit')} />
                    <Route path="ap/returns/new" element={withPermission(<PurchaseReturnForm />, 'ap_debits', 'create')} />
                    <Route path="ap/debits/new" element={withPermission(<DebitNoteForm />, 'ap_debits', 'create')} />
                    <Route path="ap/debits/edit" element={withPermission(<DebitNoteForm />, 'ap_debits', 'edit')} />
                    <Route path="ap/recurring" element={withPermission(<RecurringExpenses />, 'ap_bills')} />
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
                    <Route path="inventory/counts/new" element={withPermission(<StockCountForm />, 'inv_adj', 'create')} />
                    <Route path="inventory/counts/edit" element={withPermission(<StockCountForm />, 'inv_adj', 'edit')} />
                    <Route path="inventory/valuation" element={withPermission(<StockValuation />, 'inv_items')} />

                    {/* Point of Sale */}
                    <Route path="pos/modifiers" element={withPermission(<ModifierSettings />, 'pos_retail')} />
                    <Route path="pos/sales-types" element={withPermission(<SalesTypeSettings />, 'pos_retail')} />

                    {/* Banking */}
                    <Route path="banking/transfer" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/expense" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/income" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/payment" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/receive" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/account" element={withPermission(<BankingActionForm />, 'banking', 'create')} />
                    <Route path="banking/reconciliation" element={withPermission(<PaymentReconciliation />, 'banking')} />

                    {/* HR & Payroll */}
                    <Route path="hr" element={<Navigate to="/hr/employees" replace />} />
                    <Route path="hr/employees" element={withPermission(<Employees />, 'hr_employees')} />
                    <Route path="hr/employees/new" element={withPermission(<EmployeeForm />, 'hr_employees', 'create')} />
                    <Route path="hr/employees/edit" element={withPermission(<EmployeeForm />, 'hr_employees', 'edit')} />
                    <Route path="hr/attendance" element={withPermission(<Attendance />, 'hr_attendance')} />
                    <Route path="hr/payroll-run" element={withPermission(<PayrollRun />, 'hr_payroll')} />
                    <Route path="hr/leave" element={withPermission(<LeaveManagement />, 'hr_attendance')} />

                    {/* Assets */}
                    <Route path="assets" element={withPermission(<AssetRegister />, 'gl_journal')} />
                    <Route path="assets/categories" element={withPermission(<AssetCategories />, 'gl_journal')} />
                    <Route path="assets/new" element={withPermission(<AssetForm />, 'gl_journal', 'create')} />
                    <Route path="assets/:id" element={withPermission(<AssetDetail />, 'gl_journal')} />
                    <Route path="assets/:id/edit" element={withPermission(<AssetForm />, 'gl_journal', 'edit')} />
                    <Route path="assets/depreciation" element={withPermission(<DepreciationRun />, 'gl_journal')} />

                    <Route path="integrations" element={withPermission(<Integrations />, 'integrations')} />
                    <Route path="reports" element={withPermission(<Reports />, 'reports')} />
                    <Route path="reports/bank-reconciliation" element={withPermission(<BankReconciliation />, 'reports')} />
                    <Route path="reports/sales-performance" element={withPermission(<SalesPerformance />, 'pos_reports')} />
                    <Route path="reports/sales-by-type" element={withPermission(<SalesByType />, 'pos_reports')} />
                    <Route path="company-setup" element={withPermission(<CompanySetup />, 'company')} />
                    <Route path="settings" element={withPermission(<Settings />, 'settings')} />
                    <Route path="tools" element={withPermission(<DataTools />, 'settings')} />
                    <Route path="users" element={withPermission(<UsersAndRoles />, 'settings')} />
                </Route>
            </Routes>
            </Suspense>
        </Router>
        </ErrorBoundary>
    )
}

export default App
