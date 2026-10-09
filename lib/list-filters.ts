import { $Enums } from '@prisma/client';
import { ApiError } from './errors';

const values = (enumeration: Record<string, string>) => Object.values(enumeration);
const filters: Record<string, Record<string, string[]>> = {
  invoices: { status: values($Enums.InvoiceStatus) },
  bills: { status: values($Enums.BillStatus) },
  'ar-payments': { status: values($Enums.PaymentStatus) },
  'ap-payments': { status: values($Enums.PaymentStatus) },
  'credit-notes': { status: values($Enums.CreditNoteStatus), settlementType: values($Enums.CreditSettlementType) },
  'debit-notes': { status: values($Enums.DebitNoteStatus), settlementType: values($Enums.DebitSettlementType) },
  'sales-returns': { status: values($Enums.ReturnStatus) },
  'purchase-returns': { status: values($Enums.ReturnStatus) },
  'purchase-orders': { status: values($Enums.PurchaseOrderStatus) },
  'sales-orders': { status: values($Enums.SoStatus) },
  'delivery-notes': { status: values($Enums.DeliveryNoteStatus) },
  'journal-entries': { status: values($Enums.JournalStatus) },
  'bank-transactions': { status: values($Enums.MatchStatus), type: values($Enums.BankTxnType) },
  'stock-adjustments': { status: values($Enums.StockAdjustmentStatus), type: values($Enums.StockAdjustmentType) },
  'stock-counts': { status: values($Enums.StockCountStatus) },
  items: { type: values($Enums.ItemType) },
  accounts: { type: ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense', ...values($Enums.AccountType)] },
  customers: { status: [...values($Enums.PartnerStatus), 'ALL'] },
  vendors: { status: [...values($Enums.PartnerStatus), 'ALL'] },
  employees: { status: [...values($Enums.EmploymentStatus), 'ALL'] },
  attendance: { status: values($Enums.AttendanceStatus) },
  'leave-requests': { status: values($Enums.LeaveRequestStatus) },
  'payroll-runs': { status: values($Enums.PayrollRunStatus) },
  assets: { status: values($Enums.AssetStatus) },
  'recurring-invoices': { status: values($Enums.RecurringStatus) },
  'recurring-bills': { status: values($Enums.RecurringStatus) },
  subscriptions: { status: values($Enums.SubscriptionStatus) },
};

/** Validate only known list filters; document/report routes have their own contracts. */
export function validateListFilters(url: URL): void {
  const catalog = url.pathname.match(/^\/api\/v1\/([^/]+)\/?$/)?.[1];
  if (!catalog) return;
  for (const [key, allowed] of Object.entries(filters[catalog] ?? {})) {
    const value = url.searchParams.get(key);
    if (value && !allowed.includes(value)) throw new ApiError(`Invalid ${key} filter`, 400);
  }
}
