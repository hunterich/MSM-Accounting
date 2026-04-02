// ── Generic API response shapes ───────────────────────────────────────────────

/** Paginated list returned by listResponse() endpoints. */
export interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Raw API shapes ────────────────────────────────────────────────────────────
// These represent what the server actually sends before normalization.
// Fields are optional/loose because API shape can diverge between versions.

export interface RawCustomer {
  id: string;
  code?: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  category?: { name?: string } | string | null;
  balance?: number | string | null;
  openingBalance?: number | string | null;
  defaultDiscount?: number | string | null;
  paymentTermsDays?: number | string | null;
  paymentTerms?: number | string | null;
  creditLimit?: number | string | null;
  useCategoryDefaults?: boolean | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
}

export interface RawInvoiceLine {
  id?: string | null;
  itemId?: string | null;
  code?: string | null;
  description?: string | null;
  itemName?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  unit?: string | null;
  lineSubtotal?: number | string | null;
  discountPct?: number | string | null;
  [key: string]: unknown;
}

export interface RawInvoice {
  id: string;
  number?: string | null;
  customerId?: string | null;
  customer?: { name?: string; code?: string } | null;
  invoiceType?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  shippingDate?: string | null;
  status?: string | null;
  totalAmount?: number | string | null;
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
  discountAmount?: number | string | null;
  discountPct?: number | string | null;
  email?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  notes?: string | null;
  poNumber?: string | null;
  currency?: string | null;
  createdById?: string | null;
  createdBy?: { id?: string; fullName?: string } | null;
  lines?: RawInvoiceLine[] | null;
}

export interface RawARPayment {
  id: string;
  number?: string | null;
  customerId?: string | null;
  customer?: { name?: string } | null;
  date?: string | null;
  method?: string | null;
  totalAmount?: number | string | null;
  status?: string | null;
  invoiceId?: string | null;
  bankId?: string | null;
  depositAccountId?: string | null;
  arAccountId?: string | null;
  discountAccountId?: string | null;
  penaltyAccountId?: string | null;
}

export interface RawSalesOrderItem {
  id?: string;
  productId?: string | null;
  code?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  price?: number | string | null;
  discount?: number | string | null;
}

export interface RawSalesOrder {
  id: string;
  number?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  status?: string | null;
  notes?: string | null;
  invoiceId?: string | null;
  items?: RawSalesOrderItem[] | null;
}

export interface RawVendor {
  id: string;
  code?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  categoryId?: string | null;
  vendorCategory?: { id?: string; name?: string; code?: string } | null;
  category?: string | null;
  paymentTerms?: string | null;
  npwp?: string | null;
  defaultApAccountId?: string | null;
  status?: string | null;
  balance?: number | string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
}

export interface RawVendorCategory {
  id: string;
  name?: string | null;
  code?: string | null;
  defaultPaymentTerms?: string | null;
  defaultApAccountId?: string | null;
  description?: string | null;
  isActive?: boolean | null;
  _count?: { vendors?: number } | null;
}

export interface RawBillLine {
  price?: number | string | null;
  quantity?: number | string | null;
  lineTotal?: number | string | null;
  [key: string]: unknown;
}

export interface RawBill {
  id: string;
  number?: string | null;
  vendorId?: string | null;
  vendor?: { name?: string; code?: string } | null;
  issueDate?: string | null;
  dueDate?: string | null;
  status?: string | null;
  totalAmount?: number | string | null;
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
  apAccountId?: string | null;
  taxRate?: number | string | null;
  poNumber?: string | null;
  notes?: string | null;
  lines?: RawBillLine[] | null;
}

export interface RawAPPayment {
  id: string;
  number?: string | null;
  vendorId?: string | null;
  vendor?: { name?: string } | null;
  date?: string | null;
  method?: string | null;
  totalAmount?: number | string | null;
  status?: string | null;
  billId?: string | null;
  bankId?: string | null;
  depositAccountId?: string | null;
  apAccountId?: string | null;
  discountAccountId?: string | null;
  penaltyAccountId?: string | null;
}

export interface RawPOLine {
  price?: number | string | null;
  quantity?: number | string | null;
  lineTotal?: number | string | null;
  [key: string]: unknown;
}

export interface RawPurchaseOrder {
  id: string;
  number?: string | null;
  vendorId?: string | null;
  vendor?: { name?: string; code?: string } | null;
  date?: string | null;
  expectedDate?: string | null;
  status?: string | null;
  totalAmount?: number | string | null;
  notes?: string | null;
  lines?: RawPOLine[] | null;
}

export interface RawOrganizationSettings {
  id: string;
  legalName?: string | null;
  displayName?: string | null;
  npwp?: string | null;
  isPkp?: boolean | null;
  baseCurrency?: string | null;
  fiscalYearStart?: string | null;
  costingMethod?: 'FIFO' | 'WEIGHTED_AVERAGE' | null;
  costingMethodSetAt?: string | null;
  costingMethodSetById?: string | null;
  costingMethodEffectiveDate?: string | null;
}

// ── Normalized frontend types ─────────────────────────────────────────────────

export type CustomerStatus = 'Active' | 'Inactive';
export type InvoiceStatus  = 'Draft' | 'Sent' | 'Paid' | 'Overdue';
export type PaymentStatus  = 'Draft' | 'Processing' | 'Completed' | 'Void';
export type VendorStatus   = 'Active' | 'Inactive';
export type BillStatus     = 'Draft' | 'Unpaid' | 'Pending' | 'Paid' | 'Overdue' | 'Void';
export type POStatus       = 'Draft' | 'Approved' | 'Billed' | 'Closed' | 'Cancelled';
export type SOStatus       = 'draft' | 'confirmed' | 'closed' | 'cancelled';
export type InventoryCostingMethod = 'FIFO' | 'WEIGHTED_AVERAGE';

export interface OrganizationSettings {
  id: string;
  legalName: string;
  displayName: string;
  npwp: string;
  isPkp: boolean;
  baseCurrency: string;
  fiscalYearStart: string;
  costingMethod: InventoryCostingMethod | '';
  costingMethodSetAt: string;
  costingMethodSetById: string;
  costingMethodEffectiveDate: string;
  needsInventoryValuationSetup: boolean;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  status: CustomerStatus;
  category: string;
  balance: number;
  defaultDiscount: number;
  paymentTerms: number;
  creditLimit: number;
  useCategoryDefaults: boolean;
  billingAddress: string;
  shippingAddress: string;
}

export interface InvoiceLine {
  id?: string;
  itemId?: string;
  code?: string;
  description?: string;
  itemName?: string;
  price: number;
  quantity: number;
  unit?: string;
  lineSubtotal: number;
  discountPct: number;
  discount?: number;
  [key: string]: unknown;
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  invoiceType?: string;
  issueDate: string;
  /** Alias for issueDate — kept for date-range filter compatibility. */
  date: string;
  dueDate: string;
  shippingDate?: string;
  status: InvoiceStatus;
  amount: number;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  discountPct?: number;
  email?: string;
  billingAddress?: string;
  shippingAddress?: string;
  notes: string;
  poNumber: string;
  currency: string;
  createdById: string;
  createdByName: string;
  lines: InvoiceLine[];
  items?: InvoiceLine[];
}

export interface ARPayment {
  /** Display ID — uses ARP number if available, falls back to DB id. */
  id: string;
  /** DB primary key for mutations. */
  _id: string;
  number: string;
  customerId: string;
  customerName: string;
  date: string;
  method: string;
  amount: number;
  totalAmount: number;
  status: PaymentStatus;
  invoiceId: string;
  bankId: string;
  depositAccountId?: string;
  arAccountId?: string;
  discountAccountId?: string;
  penaltyAccountId?: string;
}

export interface SalesOrderItem {
  id?: string;
  productId: string;
  code: string;
  description?: string;
  quantity: number;
  unit: string;
  price: number;
  discount: number;
}

export interface SalesOrder {
  id: string;
  number: string;
  customerName?: string;
  customerId: string;
  issueDate: string;
  expiryDate: string;
  status: SOStatus;
  notes: string;
  invoiceId: string | null;
  items: SalesOrderItem[];
}

export interface Vendor {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  categoryId: string;
  category: string;
  categoryCode: string;
  paymentTerms: string;
  npwp: string;
  defaultApAccountId: string;
  status: VendorStatus;
  balance: number;
  billingAddress: string;
  shippingAddress: string;
}

export interface VendorCategory {
  id: string;
  name: string;
  code: string;
  defaultPaymentTerms: string;
  defaultApAccountId: string;
  description: string;
  isActive: boolean;
  vendorCount: number;
}

export interface BillLine {
  price: number;
  quantity: number;
  lineTotal: number;
  [key: string]: unknown;
}

export interface Bill {
  /** Display ID — uses BILL number if available. */
  id: string;
  /** DB primary key for mutations. */
  _id: string;
  number: string;
  vendorId: string;
  /** Alias for vendorName — kept for Bills.jsx column compatibility. */
  vendor: string;
  vendorName: string;
  vendorCode: string;
  date: string;
  issueDate: string;
  due: string;
  dueDate: string;
  status: BillStatus;
  amount: number;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  apAccountId: string;
  taxRate: number;
  poNumber: string;
  notes: string;
  lines: BillLine[];
}

export interface APPayment {
  id: string;
  _id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  date: string;
  method: string;
  amount: number;
  totalAmount: number;
  status: PaymentStatus;
  billId: string;
  bankId: string;
  depositAccountId?: string;
  apAccountId?: string;
  discountAccountId?: string;
  penaltyAccountId?: string;
}

export interface POLine {
  price: number;
  quantity: number;
  lineTotal: number;
  [key: string]: unknown;
}

export interface PurchaseOrder {
  id: string;
  _id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  date: string;
  expectedDate: string;
  status: POStatus;
  amount: number;
  totalAmount: number;
  notes: string;
  lines: POLine[];
}

// ── GL ────────────────────────────────────────────────────────────────────────

export type JEStatus = 'Draft' | 'Posted';
export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export interface RawAccountCount {
  children?: number;
}

export interface RawAccount {
  id: string;
  code?: string | null;
  name?: string | null;
  type?: string | null;
  parentId?: string | null;
  isPostable?: boolean | null;
  isActive?: boolean | null;
  hasPostings?: boolean | null;
  reportGroup?: string | null;
  reportSubGroup?: string | null;
  normalSide?: string | null;
  _count?: RawAccountCount | null;
  journalLines?: Array<{ id: string }> | null;
  level?: number | null;
  depth?: number | null;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
  reportGroup: string;
  reportSubGroup: string;
  normalSide: string;
  hasChildren: boolean;
  hasPostings: boolean;
  level: number;
  depth: number;
}

export interface RawJELine {
  id?: string;
  lineNo?: number;
  accountId?: string;
  description?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
  account?: unknown;
}

export interface RawJournalEntry {
  id: string;
  entryNo?: string | null;
  date?: string | null;
  memo?: string | null;
  source?: string | null;
  status?: string | null;
  totalDebit?: number | string | null;
  totalCredit?: number | string | null;
  periodId?: string | null;
  postedAt?: string | null;
  lines?: RawJELine[] | null;
}

export interface JELine {
  id?: string;
  lineNo?: number;
  accountId: string;
  description: string;
  debit: number;
  credit: number;
  account: unknown;
}

export interface JournalEntry {
  id: string;
  entryNo: string;
  date: string;
  memo: string;
  source: string;
  status: JEStatus;
  totalDebit: number;
  totalCredit: number;
  periodId: string | null;
  postedAt: string | null;
  lines: JELine[];
}

export interface JEFormHeader {
  date: string;
  memo: string;
  source: string;
}

export interface JEFormLine {
  accountId: string;
  description?: string;
  debit: number | string;
  credit: number | string;
}

// ── Banking ───────────────────────────────────────────────────────────────────

export type TxnType = 'income' | 'expense' | 'transfer';

export interface RawBankAccount {
  id: string;
  name?: string | null;
  bankName?: string | null;
  code?: string | null;
  accountNumber?: string | null;
  last4?: string | null;
  currentBalance?: number | string | null;
  balance?: number | string | null;
  currency?: string | null;
  isActive?: boolean | null;
  _count?: { transactions?: number } | null;
}

export interface BankAccount {
  id: string;
  name: string;
  code: string;
  bankName: string;
  accountNumber: string;
  balance: number;
  currency: string;
  isActive: boolean;
  transactionCount: number;
}

export interface RawBankTransaction {
  id: string;
  date?: string | null;
  description?: string | null;
  amount?: number | string | null;
  type?: string | null;
  bankAccountId?: string | null;
  accountId?: string | null;
  reference?: string | null;
  status?: string | null;
  notes?: string | null;
  costCenter?: string | null;
  taxType?: string | null;
  taxRate?: number | string | null;
  bankAccount?: unknown;
  toAccountId?: string | null;
  payee?: string | null;
  expenseAccountId?: string | null;
  receivedFrom?: string | null;
  incomeAccountId?: string | null;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TxnType;
  accountId: string;
  reference: string;
  status: string;
  notes: string;
  costCenter: string;
  taxType: string;
  taxRate: number;
  bankAccount: unknown;
  toAccountId: string;
  payee: string;
  expenseAccountId: string;
  receivedFrom: string;
  incomeAccountId: string;
}

export interface BankAccountFormData {
  accountNickname?: string;
  bankName?: string;
  last4?: string;
  currency?: string;
  openingBalance?: number | string;
}

export interface BankTxnFormData {
  amount?: number | string;
  date?: string;
  description?: string;
  reference?: string;
  notes?: string;
  costCenter?: string;
  taxType?: string;
  taxRate?: number | string;
  fromAccountId?: string;
  paidFromId?: string;
  depositToId?: string;
  toAccountId?: string;
  payee?: string;
  expenseAccountId?: string;
  receivedFrom?: string;
  incomeAccountId?: string;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export type ItemStockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';
export type AdjType   = 'Quantity' | 'Value';
export type AdjStatus = 'Draft' | 'Approved';

export interface RawInventoryItem {
  id: string;
  sku?: string | null;
  name?: string | null;
  type?: string | null;
  categoryId?: string | null;
  category?: { name?: string; code?: string } | null;
  openingStock?: number | string | null;
  stockQty?: number | string | null;
  stock?: number | string | null;
  cost?: number | string | null;
  costPrice?: number | string | null;
  price?: number | string | null;
  sellingPrice?: number | string | null;
  unit?: string | null;
  purchaseUnit?: string | null;
  purchaseConversionFactor?: number | string | null;
  sellUnit?: string | null;
  sellConversionFactor?: number | string | null;
  notes?: string | null;
  description?: string | null;
  barcode?: string | null;
  weight?: number | string | null;
  reorderPoint?: number | string | null;
  inventoryAccountId?: string | null;
  revenueAccountId?: string | null;
  cogsAccountId?: string | null;
}

export interface InventoryItem {
  id: string;
  sku: string;
  code?: string;
  name: string;
  type: string;
  categoryId: string | null;
  category: string;
  categoryCode: string;
  stock: number;
  cost: number;
  price: number;
  unit: string;
  purchaseUnit: string;
  purchaseConversionFactor: number | null;
  sellUnit: string;
  sellConversionFactor: number | null;
  notes: string;
  description: string;
  barcode: string;
  weight: number | string;
  openingStock: number;
  reorderPoint: number;
  inventoryAccountId: string;
  revenueAccountId: string;
  cogsAccountId: string;
  status: ItemStockStatus;
}

export interface RawItemCategory {
  id: string;
  name?: string | null;
  code?: string | null;
  description?: string | null;
  isActive?: boolean | null;
  skuSequence?: number | null;
}

export interface ItemCategory {
  id: string;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  skuSequence: number;
}

export interface RawAdjLine {
  oldQty?: number | string | null;
  newQty?: number | string | null;
  qtyDiff?: number | string | null;
  unitCost?: number | string | null;
  totalValue?: number | string | null;
  [key: string]: unknown;
}

export interface RawStockAdjustment {
  id: string;
  number?: string | null;
  date?: string | null;
  type?: string | null;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
  lines?: RawAdjLine[] | null;
}

export interface AdjLine {
  oldQty: number;
  newQty: number;
  qtyDiff: number;
  unitCost: number;
  totalValue: number;
  [key: string]: unknown;
}

export interface StockAdjustment {
  id: string;
  _id: string;
  number: string;
  date: string;
  type: AdjType;
  reason: string;
  notes: string;
  status: AdjStatus;
  lines: AdjLine[];
}

// ── HR ────────────────────────────────────────────────────────────────────────

export type EmployeeStatus = 'Active' | 'Inactive' | 'On Leave';

export interface RawEmployee {
  id: string;
  employeeNo?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: { name?: string; id?: string } | string | null;
  departmentId?: string | null;
  position?: { name?: string; id?: string } | string | null;
  positionId?: string | null;
  status?: string | null;
  basicSalary?: number | string | null;
  joinDate?: string | null;
  address?: string | null;
}

export interface Employee {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  departmentId: string;
  position: string;
  positionId: string;
  status: EmployeeStatus;
  basicSalary: number;
  joinDate: string;
  address: string;
}

// ── Returns ───────────────────────────────────────────────────────────────────

export type ReturnStatus    = 'Draft' | 'Approved' | 'Pending Credit Note' | 'Void';
export type CreditNoteStatus = 'Draft' | 'Applied' | 'Void';
export type DebitNoteStatus  = 'Draft' | 'Applied' | 'Void';

export interface RawReturnLine {
  id?: string;
  itemId?: string | null;
  itemName?: string | null;
  item?: { name?: string } | null;
  qtySold?: number | string | null;
  qtyReturn?: number | string | null;
  unit?: string | null;
  price?: number | string | null;
  lineTotal?: number | string | null;
}

export interface RawSalesReturn {
  id: string;
  number?: string | null;
  customerId?: string | null;
  customer?: { name?: string } | null;
  invoiceId?: string | null;
  invoice?: { number?: string } | null;
  returnDate?: string | null;
  warehouseId?: string | null;
  arAccountId?: string | null;
  returnAccountId?: string | null;
  taxAccountId?: string | null;
  applyTax?: boolean | null;
  taxIncluded?: boolean | null;
  taxRate?: number | string | null;
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount?: number | string | null;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
  lines?: RawReturnLine[] | null;
}

export interface SalesReturnLine {
  id?: string;
  itemId: string;
  itemName: string;
  qtySold: number;
  qtyReturn: number;
  unit: string;
  price: number;
  lineTotal: number;
}

export interface SalesReturn {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  returnDate: string;
  warehouseId: string;
  arAccountId: string;
  returnAccountId: string;
  taxAccountId: string;
  applyTax: boolean;
  taxIncluded: boolean;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  reason: string;
  notes: string;
  status: ReturnStatus;
  lines: SalesReturnLine[];
}

export interface RawPRLine {
  id?: string;
  lineKey?: string | null;
  itemId?: string | null;
  description?: string | null;
  item?: { name?: string } | null;
  qtyPurchased?: number | string | null;
  qtyReturn?: number | string | null;
  unit?: string | null;
  price?: number | string | null;
  lineTotal?: number | string | null;
}

export interface RawPurchaseReturn {
  id: string;
  number?: string | null;
  vendorId?: string | null;
  vendor?: { name?: string } | null;
  billId?: string | null;
  bill?: { number?: string } | null;
  returnDate?: string | null;
  warehouseId?: string | null;
  apAccountId?: string | null;
  returnAccountId?: string | null;
  taxAccountId?: string | null;
  applyTax?: boolean | null;
  taxIncluded?: boolean | null;
  taxRate?: number | string | null;
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount?: number | string | null;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
  lines?: RawPRLine[] | null;
}

export interface PurchaseReturnLine {
  id?: string;
  lineKey: string;
  itemId: string;
  description: string;
  qtyPurchased: number;
  qtyReturn: number;
  unit: string;
  price: number;
  lineTotal: number;
}

export interface PurchaseReturn {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  billId: string;
  billNumber: string;
  returnDate: string;
  warehouseId: string;
  apAccountId: string;
  returnAccountId: string;
  taxAccountId: string;
  applyTax: boolean;
  taxIncluded: boolean;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  reason: string;
  notes: string;
  status: ReturnStatus;
  lines: PurchaseReturnLine[];
}

export interface RawCreditNote {
  id: string;
  number?: string | null;
  salesReturnId?: string | null;
  salesReturn?: { number?: string } | null;
  customerId?: string | null;
  customer?: { name?: string } | null;
  sourceInvoiceId?: string | null;
  sourceInvoice?: { number?: string } | null;
  date?: string | null;
  settlementType?: string | null;
  settlementRef?: string | null;
  refundBankAccountId?: string | null;
  refundMethod?: string | null;
  arAccountId?: string | null;
  returnAccountId?: string | null;
  taxAccountId?: string | null;
  settlementAccountId?: string | null;
  applyTax?: boolean | null;
  amount?: number | string | null;
  note?: string | null;
  status?: string | null;
}

export interface CreditNote {
  id: string;
  number: string;
  salesReturnId: string;
  returnId: string;
  returnNumber: string;
  customerId: string;
  customerName: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string;
  date: string;
  settlementType: string;
  settlementRef: string;
  refundBankId: string;
  refundMethod: string;
  arAccountId: string;
  returnAccountId: string;
  taxAccountId: string;
  settlementAccountId: string;
  applyTax: boolean;
  amount: number;
  note: string;
  status: CreditNoteStatus;
}

export interface RawDebitNote {
  id: string;
  number?: string | null;
  purchaseReturnId?: string | null;
  purchaseReturn?: { number?: string } | null;
  vendorId?: string | null;
  vendor?: { name?: string } | null;
  sourceBillId?: string | null;
  sourceBill?: { number?: string } | null;
  date?: string | null;
  settlementType?: string | null;
  settlementRef?: string | null;
  refundBankAccountId?: string | null;
  refundMethod?: string | null;
  apAccountId?: string | null;
  returnAccountId?: string | null;
  taxAccountId?: string | null;
  settlementAccountId?: string | null;
  applyTax?: boolean | null;
  amount?: number | string | null;
  note?: string | null;
  status?: string | null;
}

export interface DebitNote {
  id: string;
  number: string;
  purchaseReturnId: string;
  returnId: string;
  returnNumber: string;
  vendorId: string;
  vendorName: string;
  sourceBillId: string;
  sourceBillNumber: string;
  date: string;
  settlementType: string;
  settlementRef: string;
  refundBankId: string;
  refundMethod: string;
  apAccountId: string;
  returnAccountId: string;
  taxAccountId: string;
  settlementAccountId: string;
  applyTax: boolean;
  amount: number;
  note: string;
  status: DebitNoteStatus;
}

export interface Warehouse {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface RawCustomerCategory {
  id: string;
  name?: string | null;
  prefix?: string | null;
  defaultCreditLimit?: number | string | null;
  defaultPaymentTerms?: number | string | null;
  defaultDiscount?: number | string | null;
  description?: string | null;
  _count?: { customers?: number } | null;
}

export interface CustomerCategory {
  id: string;
  name: string;
  prefix: string;
  defaultCreditLimit: number;
  defaultPaymentTerms: number;
  defaultDiscount: number;
  description: string;
  customerCount: number;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export interface RawAuditLog {
  id: string;
  actor?: { fullName?: string; name?: string; email?: string } | null;
  entityType?: string | null;
  entityId?: string | null;
  action?: string | null;
  payload?: unknown;
  createdAt?: string | null;
}

export interface AuditLog {
  id: string;
  actorName: string;
  actorEmail: string;
  entityType: string;
  entityLabel: string;
  entityId: string;
  action: string;
  actionLabel: string;
  payload: unknown;
  createdAt: string | null | undefined;
}
