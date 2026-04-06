import { z } from 'zod';

const decimalCoerce = z.coerce
  .number({ invalid_type_error: 'Must be a number' })
  .finite('Must be a finite number');

export const decimalNumber = decimalCoerce;

export const positiveDecimal = decimalCoerce.min(0, {
  message: 'Must be greater than or equal to 0',
});

export const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const invoiceLineInputSchema = z.object({
  itemId: z.string().trim().optional(),
  code: z.string().trim().optional(),
  description: z.string().trim().min(1, 'Description is required'),
  quantity: positiveDecimal,
  unit: z.string().trim().min(1).default('PCS'),
  price: positiveDecimal,
  discountPct: positiveDecimal.max(100).default(0),
});

export const invoiceTaxInputSchema = z.object({
  enabled: z.boolean().default(true),
  inclusive: z.boolean().default(false),
  rate: positiveDecimal.max(100).default(11),
});

export const createInvoiceInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  invoiceType: z.string().trim().default('Sales Invoice'),
  issueDate: isoDateString,
  dueDate: isoDateString.optional(),
  shippingDate: isoDateString.optional(),
  poNumber: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  billingAddress: z.string().trim().optional(),
  shippingAddress: z.string().trim().optional(),
  currency: z.string().trim().default('IDR'),
  discountPct: positiveDecimal.max(100).default(0),
  tax: invoiceTaxInputSchema.optional(),
  notes: z.string().trim().optional(),
  lines: z.array(invoiceLineInputSchema).min(1, 'At least one invoice line is required'),
});

export const createInvoiceResponseSchema = z.object({
  id: z.string(),
  number: z.string(),
  subtotal: decimalNumber,
  discountAmount: decimalNumber,
  taxAmount: decimalNumber,
  totalAmount: decimalNumber,
  currency: z.string(),
});

export const journalLineInputSchema = z
  .object({
    accountId: z.string().trim().min(1, 'Account is required'),
    description: z.string().trim().optional(),
    debit: positiveDecimal.default(0),
    credit: positiveDecimal.default(0),
  })
  .superRefine((line, ctx) => {
    if (line.debit > 0 && line.credit > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A line cannot have both debit and credit values',
      });
    }

    if (line.debit === 0 && line.credit === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A line must have debit or credit amount',
      });
    }
  });

export const createJournalEntryInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  date: isoDateString,
  periodId: z.string().trim().optional(),
  memo: z.string().trim().min(1, 'Memo is required'),
  source: z
    .enum(['MANUAL', 'ADJUSTMENT', 'ACCRUAL', 'PREPAYMENT', 'DEPRECIATION', 'CLOSING', 'OPENING', 'REVERSAL', 'SYSTEM'])
    .default('MANUAL'),
  status: z.enum(['DRAFT', 'POSTED']).default('POSTED'),
  lines: z.array(journalLineInputSchema).min(2, 'At least two lines are required'),
});

export const createJournalEntryResponseSchema = z.object({
  id: z.string(),
  entryNo: z.string(),
  totalDebit: decimalNumber,
  totalCredit: decimalNumber,
  status: z.enum(['DRAFT', 'POSTED']),
});

export const accountTypeSchema = z.enum(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
export const normalSideSchema = z.enum(['Debit', 'Credit']);

const accountBaseFields = {
  code: z.string().trim().min(1, 'Account code is required'),
  name: z.string().trim().min(1, 'Account name is required'),
  type: accountTypeSchema,
  parentId: z.string().trim().min(1).nullable().optional(),
  isPostable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  reportGroup: z.string().trim().min(1, 'Report group is required'),
  reportSubGroup: z.string().trim().optional(),
  normalSide: normalSideSchema.optional(),
};

export const createAccountInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  ...accountBaseFields,
});

export const updateAccountInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  code: accountBaseFields.code.optional(),
  name: accountBaseFields.name.optional(),
  type: accountBaseFields.type.optional(),
  parentId: accountBaseFields.parentId,
  isPostable: accountBaseFields.isPostable.optional(),
  isActive: accountBaseFields.isActive.optional(),
  reportGroup: accountBaseFields.reportGroup.optional(),
  reportSubGroup: accountBaseFields.reportSubGroup.optional(),
  normalSide: accountBaseFields.normalSide,
});

export const dashboardSummaryQuerySchema = z.object({
  organizationId: z.string().trim().min(1),
});

export const departmentInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Department name is required'),
});

export const positionInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Position name is required'),
});

export const accountingPeriodInputSchema = z
  .object({
    organizationId: z.string().trim().min(1),
    name: z.string().trim().min(1, 'Period name is required'),
    startDate: isoDateString,
    endDate: isoDateString,
    status: z.enum(['OPEN', 'CLOSED']).default('OPEN'),
    isLocked: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endDate must be on or after startDate',
        path: ['endDate'],
      });
    }
  });

export const accountingPeriodCloseInputSchema = z.object({
  lock: z.boolean().default(true),
});

export const warehouseInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  code: z.string().trim().min(1, 'Warehouse code is required'),
  name: z.string().trim().min(1, 'Warehouse name is required'),
});

const documentLineSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  itemId: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  description: z.string().trim().min(1, 'Description is required'),
  quantity: positiveDecimal.default(0),
  unit: z.string().trim().min(1).default('PCS'),
  price: positiveDecimal.default(0),
  lineTotal: positiveDecimal.optional(),
});

export const billInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  vendorId: z.string().trim().min(1, 'Vendor is required'),
  poId: z.string().trim().optional(),
  issueDate: isoDateString,
  dueDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'OPEN', 'PENDING', 'PAID', 'OVERDUE', 'VOID']).default('DRAFT'),
  apAccountId: z.string().trim().optional(),
  taxRate: positiveDecimal.max(100).default(0),
  subtotal: positiveDecimal.default(0),
  taxAmount: positiveDecimal.default(0),
  totalAmount: positiveDecimal.default(0),
  notes: z.string().trim().optional(),
  lines: z.array(documentLineSchema).default([]),
});

export const updateBillInputSchema = z.object({
  vendorId: z.string().trim().min(1).optional(),
  poId: z.string().trim().optional(),
  issueDate: isoDateString.optional(),
  dueDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'OPEN', 'PENDING', 'PAID', 'OVERDUE', 'VOID']).optional(),
  apAccountId: z.string().trim().optional(),
  taxRate: positiveDecimal.max(100).optional(),
  subtotal: positiveDecimal.optional(),
  taxAmount: positiveDecimal.optional(),
  totalAmount: positiveDecimal.optional(),
  notes: z.string().trim().optional(),
  lines: z.array(documentLineSchema).optional(),
});

export const purchaseOrderInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  vendorId: z.string().trim().min(1, 'Vendor is required'),
  date: isoDateString,
  expectedDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PARTIAL_RECEIVED', 'CLOSED', 'CANCELLED']).default('DRAFT'),
  taxRate: positiveDecimal.max(100).default(0),
  subtotal: positiveDecimal.default(0),
  taxAmount: positiveDecimal.default(0),
  totalAmount: positiveDecimal.default(0),
  notes: z.string().trim().optional(),
  lines: z.array(documentLineSchema).default([]),
});

export const updatePurchaseOrderInputSchema = z.object({
  vendorId: z.string().trim().min(1).optional(),
  date: isoDateString.optional(),
  expectedDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PARTIAL_RECEIVED', 'CLOSED', 'CANCELLED']).optional(),
  taxRate: positiveDecimal.max(100).optional(),
  subtotal: positiveDecimal.optional(),
  taxAmount: positiveDecimal.optional(),
  totalAmount: positiveDecimal.optional(),
  notes: z.string().trim().optional(),
  lines: z.array(documentLineSchema).optional(),
});

const paymentAllocationBaseSchema = z.object({
  amountApplied: positiveDecimal.default(0),
  discountAmount: positiveDecimal.default(0),
  penaltyAmount: positiveDecimal.default(0),
});

export const arPaymentAllocationInputSchema = paymentAllocationBaseSchema.extend({
  invoiceId: z.string().trim().min(1, 'Invoice is required'),
});

export const apPaymentAllocationInputSchema = paymentAllocationBaseSchema.extend({
  billId: z.string().trim().min(1, 'Bill is required'),
});

const paymentBaseSchema = z.object({
  date: isoDateString,
  method: z.enum(['BANK_TRANSFER', 'CHECK', 'CREDIT_CARD', 'CASH', 'OTHER']).default('BANK_TRANSFER'),
  bankAccountId: z.string().trim().optional(),
  depositAccountId: z.string().trim().optional(),
  arAccountId: z.string().trim().optional(),
  apAccountId: z.string().trim().optional(),
  discountAccountId: z.string().trim().optional(),
  penaltyAccountId: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'PROCESSING', 'COMPLETED', 'VOID']).default('DRAFT'),
  totalAmount: positiveDecimal,
});

export const arPaymentInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  customerId: z.string().trim().min(1, 'Customer is required'),
  ...paymentBaseSchema.shape,
  allocations: z.array(arPaymentAllocationInputSchema).optional(),
});

export const updateArPaymentInputSchema = arPaymentInputSchema.omit({ organizationId: true }).partial();

export const apPaymentInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  vendorId: z.string().trim().min(1, 'Vendor is required'),
  ...paymentBaseSchema.shape,
  allocations: z.array(apPaymentAllocationInputSchema).optional(),
});

export const updateApPaymentInputSchema = apPaymentInputSchema.omit({ organizationId: true }).partial();

export const salesOrderItemInputSchema = z.object({
  productId: z.string().trim().optional(),
  code: z.string().trim().optional(),
  description: z.string().trim().min(1, 'Description is required'),
  quantity: positiveDecimal.default(1),
  unit: z.string().trim().min(1).default('PCS'),
  price: positiveDecimal.default(0),
  discount: positiveDecimal.max(100).default(0),
});

export const salesOrderInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  customerId: z.string().trim().optional(),
  customerName: z.string().trim().min(1, 'Customer name is required'),
  issueDate: isoDateString.optional(),
  expiryDate: isoDateString.optional(),
  number: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'INVOICED', 'CANCELLED']).default('DRAFT'),
  items: z.array(salesOrderItemInputSchema).default([]),
});

export const updateSalesOrderInputSchema = salesOrderInputSchema.omit({ organizationId: true }).partial();

export const stockAdjustmentLineInputSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  itemId: z.string().trim().min(1, 'Item is required'),
  accountId: z.string().trim().optional(),
  oldQty: decimalNumber.default(0),
  newQty: decimalNumber.default(0),
  qtyDiff: decimalNumber.optional(),
  unitCost: positiveDecimal.default(0),
  totalValue: decimalNumber.optional(),
});

export const stockAdjustmentInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  date: isoDateString,
  type: z.enum(['QUANTITY', 'VALUE']).default('QUANTITY'),
  reason: z.string().trim().min(1, 'Reason is required'),
  notes: z.string().trim().optional(),
  warehouseId: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'APPROVED']).default('DRAFT'),
  lines: z.array(stockAdjustmentLineInputSchema).default([]),
});

export const updateStockAdjustmentInputSchema = stockAdjustmentInputSchema.omit({ organizationId: true }).partial();

export const bankTransactionInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  number: z.string().trim().optional(),
  bankAccountId: z.string().trim().min(1, 'Bank account is required'),
  date: isoDateString,
  description: z.string().trim().min(1, 'Description is required'),
  amount: positiveDecimal,
  type: z.enum(['TRANSFER', 'EXPENSE', 'INCOME']),
  status: z.enum(['MATCHED', 'UNMATCHED']).default('UNMATCHED'),
  reference: z.string().trim().optional(),
  costCenter: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  taxType: z.enum(['NONE', 'PPN', 'GST', 'WITHHOLDING']).default('NONE'),
  taxRate: positiveDecimal.max(100).default(0),
  toBankAccountId: z.string().trim().optional(),
  payee: z.string().trim().optional(),
  receivedFrom: z.string().trim().optional(),
  expenseAccountId: z.string().trim().optional(),
  incomeAccountId: z.string().trim().optional(),
});

export const updateBankTransactionInputSchema = bankTransactionInputSchema.omit({ organizationId: true }).partial();

export const employeeCompensationItemInputSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, 'Compensation item name is required'),
  amount: positiveDecimal.default(0),
});

export const employeeInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Employee name is required'),
  ktp: z.string().trim().optional(),
  dob: isoDateString.optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().optional(),
  joinDate: isoDateString,
  departmentId: z.string().trim().optional(),
  positionId: z.string().trim().optional(),
  department: z.string().trim().optional(),
  position: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  type: z.enum(['FULL_TIME', 'CONTRACT']).default('FULL_TIME'),
  bankName: z.string().trim().optional(),
  accountNumber: z.string().trim().optional(),
  accountHolder: z.string().trim().optional(),
  npwp: z.string().trim().optional(),
  bpjsKesehatan: z.string().trim().optional(),
  bpjsKetenagakerjaan: z.string().trim().optional(),
  basicSalary: positiveDecimal.default(0),
  allowances: z.array(employeeCompensationItemInputSchema).default([]),
  deductions: z.array(employeeCompensationItemInputSchema).default([]),
});

export const updateEmployeeInputSchema = employeeInputSchema.omit({ organizationId: true }).partial();

export const integrationInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  platform: z.enum(['SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'LAZADA', 'OTHER']),
  shopName: z.string().trim().min(1, 'Shop name is required'),
  customerId: z.string().trim().nullable().optional(),
  holdingAccountId: z.string().trim().nullable().optional(),
  status: z.enum(['ACTIVE', 'SYNCING', 'INACTIVE']).default('ACTIVE'),
  importStatusFilter: z.enum(['Selesai', 'All']).default('Selesai'),
  itemMappings: z.record(z.string().trim(), z.string().trim()).default({}),
});

export const updateIntegrationInputSchema = integrationInputSchema.omit({ organizationId: true }).partial();

export const agingBucketSchema = z.object({
  current: decimalNumber,
  d1To30: decimalNumber,
  d31To60: decimalNumber,
  d61To90: decimalNumber,
  d90Plus: decimalNumber,
  totalOutstanding: decimalNumber,
});

export const customerBalanceRowSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable().optional(),
  customerName: z.string(),
  invoicedAmount: decimalNumber,
  paidAmount: decimalNumber,
  outstandingAmount: decimalNumber,
});

export const dashboardSummaryResponseSchema = z.object({
  organizationId: z.string(),
  cashOnHand: decimalNumber,
  invoiceReceivable: decimalNumber,
  overdueInvoiceCount: z.number().int().nonnegative(),
  overdueAmount: decimalNumber,
  aging: agingBucketSchema,
  customerBalances: z.array(customerBalanceRowSchema),
  generatedAt: z.string(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;
export type CreateInvoiceResponse = z.infer<typeof createInvoiceResponseSchema>;
export type CreateJournalEntryInput = z.infer<typeof createJournalEntryInputSchema>;
export type CreateJournalEntryResponse = z.infer<typeof createJournalEntryResponseSchema>;
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;
export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;
export type DepartmentInput = z.infer<typeof departmentInputSchema>;
export type PositionInput = z.infer<typeof positionInputSchema>;
export type AccountingPeriodInput = z.infer<typeof accountingPeriodInputSchema>;
export type AccountingPeriodCloseInput = z.infer<typeof accountingPeriodCloseInputSchema>;
export type WarehouseInput = z.infer<typeof warehouseInputSchema>;
export type BillInput = z.infer<typeof billInputSchema>;
export type UpdateBillInput = z.infer<typeof updateBillInputSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderInputSchema>;
export type ArPaymentInput = z.infer<typeof arPaymentInputSchema>;
export type UpdateArPaymentInput = z.infer<typeof updateArPaymentInputSchema>;
export type ApPaymentInput = z.infer<typeof apPaymentInputSchema>;
export type UpdateApPaymentInput = z.infer<typeof updateApPaymentInputSchema>;
export type SalesOrderInput = z.infer<typeof salesOrderInputSchema>;
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderInputSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>;
export type UpdateStockAdjustmentInput = z.infer<typeof updateStockAdjustmentInputSchema>;
export type BankTransactionInput = z.infer<typeof bankTransactionInputSchema>;
export type UpdateBankTransactionInput = z.infer<typeof updateBankTransactionInputSchema>;
export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeInputSchema>;
export type IntegrationInput = z.infer<typeof integrationInputSchema>;
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationInputSchema>;
