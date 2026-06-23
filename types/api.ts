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

const optionalNullableString = z.union([z.string(), z.null()]).optional();

const optionalEmailString = z
  .union([z.string().trim().email('Invalid email address'), z.literal(''), z.null()])
  .optional();

export const updateCustomerInputSchema = z.object({
  id: optionalNullableString,
  code: optionalNullableString,
  name: z.string().trim().min(1, 'Customer name is required').optional(),
  email: optionalEmailString,
  phone: optionalNullableString,
  website: optionalNullableString,
  contactPerson: optionalNullableString,
  billingAddress: optionalNullableString,
  shippingAddress: optionalNullableString,
  address1: optionalNullableString,
  city: optionalNullableString,
  province: optionalNullableString,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  taxable: z.boolean().optional(),
  paymentTerms: z.coerce.number().int().min(0, 'Payment terms must be non-negative').optional(),
  paymentTermsDays: z.coerce.number().int().min(0, 'Payment terms must be non-negative').optional(),
  defaultDiscount: positiveDecimal.max(100).optional(),
  creditLimit: positiveDecimal.optional(),
  openingBalance: positiveDecimal.optional(),
  initialBalance: positiveDecimal.optional(),
  useCategoryDefaults: z.boolean().optional(),
  categoryId: optionalNullableString,
  category: optionalNullableString,
});

export const createCustomerInputSchema = updateCustomerInputSchema.extend({
  name: z.string().trim().min(1, 'Customer name is required'),
}).superRefine((value, ctx) => {
  if (!value.code?.trim() && !value.id?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['code'],
      message: 'Customer code is required',
    });
  }
});

export const updateVendorInputSchema = z.object({
  code: optionalNullableString,
  name: z.string().trim().min(1, 'Vendor name is required').optional(),
  email: optionalEmailString,
  phone: optionalNullableString,
  paymentTerms: optionalNullableString,
  npwp: optionalNullableString,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  defaultApAccountId: optionalNullableString,
  categoryId: optionalNullableString,
  category: optionalNullableString,
});

export const createVendorInputSchema = updateVendorInputSchema.extend({
  code: z.string().trim().min(1, 'Vendor code is required'),
  name: z.string().trim().min(1, 'Vendor name is required'),
  defaultApAccountId: z.string().trim().min(1, 'Default A/P account is required'),
});

export const customerCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required'),
  prefix: z.string().trim().min(1, 'Prefix is required').max(12, 'Prefix is too long'),
  defaultCreditLimit: positiveDecimal.default(0),
  defaultPaymentTerms: z.coerce.number().int().min(0, 'Default payment terms must be non-negative').default(0),
  defaultDiscount: positiveDecimal.max(100).default(0),
  description: optionalNullableString,
});

export const updateCustomerCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').optional(),
  prefix: z.string().trim().min(1, 'Prefix is required').max(12, 'Prefix is too long').optional(),
  defaultCreditLimit: positiveDecimal.optional(),
  defaultPaymentTerms: z.coerce.number().int().min(0, 'Default payment terms must be non-negative').optional(),
  defaultDiscount: positiveDecimal.max(100).optional(),
  description: optionalNullableString,
});

export const vendorCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required'),
  code: z.string().trim().min(1, 'Code is required').max(12, 'Code is too long'),
  defaultPaymentTerms: optionalNullableString,
  defaultApAccountId: optionalNullableString,
  description: optionalNullableString,
  isActive: z.boolean().default(true),
});

export const updateVendorCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').optional(),
  code: z.string().trim().min(1, 'Code is required').max(12, 'Code is too long').optional(),
  defaultPaymentTerms: optionalNullableString,
  defaultApAccountId: optionalNullableString,
  description: optionalNullableString,
  isActive: z.boolean().optional(),
});

export const itemCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required'),
  code: z.string().trim().min(1, 'Code is required').max(12, 'Code is too long'),
  description: optionalNullableString,
  isActive: z.boolean().default(true),
});

export const updateItemCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').optional(),
  code: z.string().trim().min(1, 'Code is required').max(12, 'Code is too long').optional(),
  description: optionalNullableString,
  isActive: z.boolean().optional(),
});

export const updateItemInputSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').optional(),
  name: z.string().trim().min(1, 'Item name is required').optional(),
  categoryId: optionalNullableString,
  type: z.enum(['PRODUCT', 'SERVICE', 'RAW_MATERIAL', 'CONSUMABLE', 'FIXED_ASSET']).optional(),
  unit: z.string().trim().min(1, 'Unit is required').optional(),
  purchaseUnit: optionalNullableString,
  purchaseConversionFactor: positiveDecimal.optional().nullable(),
  sellUnit: optionalNullableString,
  sellConversionFactor: positiveDecimal.optional().nullable(),
  barcode: optionalNullableString,
  description: optionalNullableString,
  weight: positiveDecimal.optional().nullable(),
  cost: positiveDecimal.optional(),
  costPrice: positiveDecimal.optional(),
  price: positiveDecimal.optional(),
  sellingPrice: positiveDecimal.optional(),
  openingStock: positiveDecimal.optional(),
  reorderPoint: positiveDecimal.optional(),
  inventoryAccountId: optionalNullableString,
  revenueAccountId: optionalNullableString,
  cogsAccountId: optionalNullableString,
  isActive: z.boolean().optional(),
});

export const createItemInputSchema = updateItemInputSchema.extend({
  sku: z.string().trim().min(1, 'SKU is required'),
  name: z.string().trim().min(1, 'Item name is required'),
  unit: z.string().trim().min(1, 'Unit is required').default('PCS'),
  type: z.enum(['PRODUCT', 'SERVICE', 'RAW_MATERIAL', 'CONSUMABLE', 'FIXED_ASSET']).default('PRODUCT'),
  openingStock: positiveDecimal.default(0),
  reorderPoint: positiveDecimal.default(0),
  cost: positiveDecimal.optional(),
  costPrice: positiveDecimal.optional(),
  price: positiveDecimal.optional(),
  sellingPrice: positiveDecimal.optional(),
  isActive: z.boolean().default(true),
});

export const updateOrganizationSettingsInputSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal company name is required').optional(),
  displayName: z.string().trim().min(1, 'Display name is required').optional(),
  npwp: optionalNullableString,
  isPkp: z.boolean().optional(),
  baseCurrency: z.string().trim().min(1, 'Base currency is required').optional(),
  timezone: z.string().trim().min(1, 'Timezone is required').optional(),
  locale: z.string().trim().min(1, 'Locale is required').optional(),
  fiscalYearStart: isoDateString.nullable().optional(),
  costingMethod: z.enum(['FIFO', 'WEIGHTED_AVERAGE']).nullable().optional(),
  costingMethodEffectiveDate: isoDateString.nullable().optional(),
  defaultCreditLimit: positiveDecimal.optional(),
  enforceCreditLimit: z.boolean().optional(),
  taxEnabled: z.boolean().optional(),
  taxDefaultRate: positiveDecimal.max(100).optional(),
  taxInclusiveByDefault: z.boolean().optional(),
  address: optionalNullableString,
  phone: optionalNullableString,
  companyEmail: optionalEmailString,
  logoUrl: optionalNullableString,
  financeEmail: optionalEmailString,
  invoiceReminders: z.boolean().optional(),
  paymentAlerts: z.boolean().optional(),
  dailySummary: z.boolean().optional(),
  accountDefaults: z.record(z.string().min(1), z.string()).optional(),
  printSettings: z.object({
    showLogo: z.boolean().optional(),
    showLetterhead: z.boolean().optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Accent color must be a hex value like #1A2B3C').optional(),
    density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
    defaultPaperSize: z.enum(['A4', 'A5']).optional(),
    showUnitColumn: z.boolean().optional(),
    showDiscountColumn: z.boolean().optional(),
    footerText: z.string().max(500).optional(),
    termsText: z.string().max(2000).optional(),
    showSignature: z.boolean().optional(),
    signatureLabel: z.string().max(120).optional(),
    signerName: z.string().max(120).optional(),
  }).optional(),
});

const documentLineSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  itemId: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  purchaseOrderLineId: z.string().trim().optional(),
  // Transient (not a BillLine column): set on lines pulled from an existing
  // goods receipt so the bill bills already-received stock without re-incrementing
  // PurchaseOrderLine.receivedQty (which the receipt already did).
  alreadyReceived: z.boolean().optional(),
  description: z.string().trim().min(1, 'Description is required'),
  quantity: positiveDecimal.default(0),
  unit: z.string().trim().min(1).default('PCS'),
  price: positiveDecimal.default(0),
  discountPct: positiveDecimal.max(100).optional(),
  lineTotal: positiveDecimal.optional(),
});

export const billInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  vendorId: z.string().trim().min(1, 'Vendor is required'),
  vendorInvoiceNo: z.string().trim().optional(),
  poId: z.string().trim().optional(),
  issueDate: isoDateString,
  dueDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'OPEN', 'PENDING', 'PAID', 'OVERDUE', 'VOID']).default('DRAFT'),
  apAccountId: z.string().trim().optional(),
  taxRate: positiveDecimal.max(100).default(0),
  taxable: z.boolean().default(false),
  taxInclusive: z.boolean().default(false),
  subtotal: positiveDecimal.default(0),
  taxAmount: positiveDecimal.default(0),
  totalAmount: positiveDecimal.default(0),
  notes: z.string().trim().optional(),
  lines: z.array(documentLineSchema).default([]),
});

export const updateBillInputSchema = z.object({
  vendorId: z.string().trim().min(1).optional(),
  vendorInvoiceNo: z.string().trim().optional(),
  poId: z.string().trim().optional(),
  issueDate: isoDateString.optional(),
  dueDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'OPEN', 'PENDING', 'PAID', 'OVERDUE', 'VOID']).optional(),
  apAccountId: z.string().trim().optional(),
  taxRate: positiveDecimal.max(100).optional(),
  taxable: z.boolean().optional(),
  taxInclusive: z.boolean().optional(),
  subtotal: positiveDecimal.optional(),
  taxAmount: positiveDecimal.optional(),
  totalAmount: positiveDecimal.optional(),
  notes: z.string().trim().optional(),
  lines: z.array(documentLineSchema).optional(),
});

const nullableLooseString = z.union([z.string().trim(), z.literal(''), z.null()]).optional();

export const billImportSuggestionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().trim().min(1),
});

export const billImportLineSchema = z.object({
  lineNo: z.coerce.number().int().positive().default(1),
  rawText: z.string().default(''),
  supplierLabel: z.string().default(''),
  supplierSku: nullableLooseString,
  description: z.string().default(''),
  quantity: positiveDecimal.default(1),
  unit: z.string().trim().min(1).default('PCS'),
  price: positiveDecimal.default(0),
  lineTotal: positiveDecimal.default(0),
  itemId: nullableLooseString,
  accountId: nullableLooseString,
  itemSuggestion: billImportSuggestionSchema.nullable().optional(),
  reviewStatus: z.enum(['matched', 'needs_review']).default('needs_review'),
});

export const billImportReviewDataSchema = z.object({
  vendorId: nullableLooseString,
  vendorSuggestion: billImportSuggestionSchema.nullable().optional(),
  issueDate: z.union([isoDateString, z.literal('')]).default(''),
  dueDate: z.union([isoDateString, z.literal('')]).default(''),
  taxRate: positiveDecimal.default(0),
  taxAmount: positiveDecimal.default(0),
  subtotal: positiveDecimal.default(0),
  totalAmount: positiveDecimal.default(0),
  notes: z.string().default(''),
  lines: z.array(billImportLineSchema).default([]),
  needsReviewCount: z.coerce.number().int().min(0).default(0),
  readyToImport: z.boolean().default(false),
});

export const updateBillImportSessionInputSchema = z.object({
  reviewData: billImportReviewDataSchema,
});

export const finalizeBillImportInputSchema = z.object({
  reviewData: billImportReviewDataSchema.optional(),
});

export const purchaseOrderInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  vendorId: z.string().trim().min(1, 'Vendor is required'),
  date: isoDateString,
  expectedDate: isoDateString.optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PARTIAL_RECEIVED', 'CLOSED', 'CANCELLED']).default('DRAFT'),
  taxRate: positiveDecimal.max(100).default(0),
  taxable: z.boolean().default(false),
  taxInclusive: z.boolean().default(false),
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
  taxable: z.boolean().optional(),
  taxInclusive: z.boolean().optional(),
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
  cashAccountId: z.string().trim().optional(),
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

export const stockCountCreateSchema = z.object({
  organizationId: z.string().trim().min(1),
  date: isoDateString,
  warehouseId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  countedBy: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const stockCountLineUpdateSchema = z.object({
  itemId: z.string().trim().min(1, 'Item is required'),
  countedQty: decimalNumber.nullable().optional(), // null = not counted
  note: z.string().trim().optional(),
});

export const stockCountUpdateSchema = z.object({
  notes: z.string().trim().optional(),
  countedBy: z.string().trim().optional(),
  lines: z.array(stockCountLineUpdateSchema).optional(),
});

export type StockCountCreateInput = z.infer<typeof stockCountCreateSchema>;
export type StockCountUpdateInput = z.infer<typeof stockCountUpdateSchema>;

export const createBankAccountInputSchema = z.object({
  name:           z.string().trim().min(1, 'Account name is required'),
  bankName:       z.string().trim().optional().nullable(),
  last4:          z.string().trim().max(20).optional().nullable(),
  currency:       z.string().trim().default('IDR'),
  openingBalance: z.coerce.number().default(0),
  isActive:       z.boolean().default(true),
});

export const updateBankAccountInputSchema = createBankAccountInputSchema.partial();

export type CreateBankAccountInput = z.infer<typeof createBankAccountInputSchema>;
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountInputSchema>;

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

// Per-shop accounting mappings stored on EcommerceConnection.mappings (JSONB).
// Account ids are nullable so an operator can save a partial draft.
const accountIdField = z.string().trim().min(1).nullable().optional();

const feesSchema = z.object({
  sellerDiscountAccountId: accountIdField,
  shippingVarianceAccountId: accountIdField,
  platformFeeAccountId: accountIdField,
  adjustmentAccountId: accountIdField,
  affiliateFeeAccountId: accountIdField,
}).partial();

const shippingSchema = z.object({
  buyerShippingRevenueAccountId: accountIdField,
  actualShippingCostAccountId: accountIdField,
  platformShippingSubsidyAccountId: accountIdField,
  shippingInsuranceAccountId: accountIdField,
  codFeeAccountId: accountIdField,
}).partial();

const othersSchema = z.object({
  refundAccountId: accountIdField,
  sellerVoucherAccountId: accountIdField,
  platformVoucherAccountId: accountIdField,
  coinCashbackAccountId: accountIdField,
  withholdingTaxAccountId: accountIdField,
  roundingAccountId: accountIdField,
  notes: z.string().trim().max(2000).optional(),
}).partial();

export const shopMappingsSchema = z.object({
  paymentMode: z.enum(['direct', 'settlement_import']).default('settlement_import'),
  vatInclusive: z.boolean().default(false),
  fees: feesSchema.optional(),
  shipping: shippingSchema.optional(),
  others: othersSchema.optional(),
}).superRefine((val, ctx) => {
  if (val.paymentMode !== 'settlement_import') return;
  const required: Array<[keyof z.infer<typeof feesSchema>, string]> = [
    ['sellerDiscountAccountId', 'Seller discount account is required when using settlement import.'],
    ['shippingVarianceAccountId', 'Shipping variance account is required when using settlement import.'],
    ['platformFeeAccountId', 'Platform fee account is required when using settlement import.'],
    ['adjustmentAccountId', 'Adjustment account is required when using settlement import.'],
    ['affiliateFeeAccountId', 'Affiliate fee account is required when using settlement import.'],
  ];
  for (const [field, message] of required) {
    if (!val.fees?.[field]) {
      ctx.addIssue({ code: 'custom', path: ['fees', field as string], message });
    }
  }
});

export type ShopMappings = z.infer<typeof shopMappingsSchema>;

export const integrationInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  platform: z.enum(['SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'LAZADA', 'OTHER']),
  shopName: z.string().trim().min(1, 'Shop name is required'),
  customerId: z.string().trim().nullable().optional(),
  holdingAccountId: z.string().trim().nullable().optional(),
  status: z.enum(['ACTIVE', 'SYNCING', 'INACTIVE']).default('ACTIVE'),
  importStatusFilter: z.enum(['Selesai', 'All']).default('Selesai'),
  itemMappings: z.record(z.string().trim(), z.string().trim()).default({}),
  mappings: shopMappingsSchema.optional(),
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
export type BillImportSuggestion = z.infer<typeof billImportSuggestionSchema>;
export type BillImportLine = z.infer<typeof billImportLineSchema>;
export type BillImportReviewData = z.infer<typeof billImportReviewDataSchema>;
export type UpdateBillImportSessionInput = z.infer<typeof updateBillImportSessionInputSchema>;
export type FinalizeBillImportInput = z.infer<typeof finalizeBillImportInputSchema>;
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

// ── HR: Attendance, Leave Types, Leave Requests, Payroll Runs ────────────────

export const attendanceRecordInputSchema = z.object({
  organizationId: z.string().min(1),
  employeeId: z.string().min(1),
  date: isoDateString,
  status: z.enum(['PRESENT', 'ABSENT', 'SICK', 'LEAVE', 'LATE', 'HALF_DAY']).default('PRESENT'),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  hoursWorked: z.coerce.number().min(0).optional(),
  overtimeHours: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
});
export const updateAttendanceRecordInputSchema = attendanceRecordInputSchema
  .omit({ organizationId: true, employeeId: true, date: true })
  .partial();

export const leaveTypeInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1, 'name is required'),
  category: z.enum(['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']).default('ANNUAL'),
  entitlementDays: z.coerce.number().int().min(0).default(12),
  carryOver: z.boolean().default(false),
  maxCarryDays: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export const updateLeaveTypeInputSchema = leaveTypeInputSchema.omit({ organizationId: true }).partial();

export const leaveRequestInputSchema = z.object({
  organizationId: z.string().min(1),
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  startDate: isoDateString,
  endDate: isoDateString,
  totalDays: z.coerce.number().int().min(1, 'totalDays must be at least 1'),
  reason: z.string().optional(),
});
export const updateLeaveRequestInputSchema = leaveRequestInputSchema
  .omit({ organizationId: true })
  .partial()
  .extend({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    reviewNote: z.string().optional(),
  });

export const payrollRunInputSchema = z.object({
  organizationId: z.string().min(1),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  periodStart: isoDateString,
  periodEnd: isoDateString,
  notes: z.string().optional(),
});

// ── Asset Management ─────────────────────────────────────────────────────────

const depreciationMethodEnum = z.enum(['STRAIGHT_LINE', 'DECLINING_BALANCE', 'DOUBLE_DECLINING']);

export const assetCategoryInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1, 'name is required'),
  depreciationMethod: depreciationMethodEnum.default('STRAIGHT_LINE'),
  usefulLifeMonths: z.coerce.number().int().min(1).default(60),
  salvagePercent: z.coerce.number().min(0).max(100).default(0),
  assetAccountId: z.string().optional().nullable(),
  depExpenseAccountId: z.string().optional().nullable(),
  accumDepAccountId: z.string().optional().nullable(),
});
export const updateAssetCategoryInputSchema = assetCategoryInputSchema.omit({ organizationId: true }).partial();

export const assetInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  categoryId: z.string().min(1, 'categoryId is required'),
  acquisitionDate: isoDateString,
  acquisitionCost: z.coerce.number().min(0, 'acquisitionCost must be >= 0'),
  depreciationMethod: depreciationMethodEnum.default('STRAIGHT_LINE'),
  usefulLifeMonths: z.coerce.number().int().min(1).default(60),
  salvageValue: z.coerce.number().min(0).default(0),
  location: z.string().optional(),
  custodian: z.string().optional(),
  department: z.string().optional(),
  serialNumber: z.string().optional(),
  vendor: z.string().optional(),
});
export const updateAssetInputSchema = assetInputSchema.omit({ organizationId: true }).partial();

export const assetDisposalInputSchema = z.object({
  disposalDate: isoDateString,
  disposalAmount: z.coerce.number().min(0, 'disposalAmount must be >= 0'),
  disposalMethod: z.string().min(1, 'disposalMethod is required'),
  notes: z.string().optional(),
});

export const assetDepreciationRunInputSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

// Inferred types
export type AttendanceRecordInput = z.infer<typeof attendanceRecordInputSchema>;
export type UpdateAttendanceRecordInput = z.infer<typeof updateAttendanceRecordInputSchema>;
export type LeaveTypeInput = z.infer<typeof leaveTypeInputSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeInputSchema>;
export type LeaveRequestInput = z.infer<typeof leaveRequestInputSchema>;
export type UpdateLeaveRequestInput = z.infer<typeof updateLeaveRequestInputSchema>;
export type PayrollRunInput = z.infer<typeof payrollRunInputSchema>;
export type AssetCategoryInput = z.infer<typeof assetCategoryInputSchema>;
export type UpdateAssetCategoryInput = z.infer<typeof updateAssetCategoryInputSchema>;
export type AssetInput = z.infer<typeof assetInputSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetInputSchema>;
export type AssetDisposalInput = z.infer<typeof assetDisposalInputSchema>;
export type AssetDepreciationRunInput = z.infer<typeof assetDepreciationRunInputSchema>;
