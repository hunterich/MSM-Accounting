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

export const dashboardSummaryQuerySchema = z.object({
  organizationId: z.string().trim().min(1),
});

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

const ACCOUNT_TYPES_ZOD = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] as const;
const NORMAL_SIDES_ZOD = ['Debit', 'Credit'] as const;

export const createAccountInputSchema = z.object({
  organizationId: z.string().trim().min(1),
  code: z.string().trim().min(1, 'Account code is required'),
  name: z.string().trim().min(1, 'Account name is required'),
  type: z.enum(ACCOUNT_TYPES_ZOD),
  reportGroup: z.string().trim().min(1, 'Report group is required'),
  reportSubGroup: z.string().trim().optional().nullable(),
  parentId: z.string().trim().optional().nullable(),
  isPostable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  normalSide: z.enum(NORMAL_SIDES_ZOD).optional(),
});

export const updateAccountInputSchema = createAccountInputSchema
  .omit({ organizationId: true })
  .partial()
  .extend({ organizationId: z.string().trim().min(1) });

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;
export type CreateInvoiceResponse = z.infer<typeof createInvoiceResponseSchema>;
export type CreateJournalEntryInput = z.infer<typeof createJournalEntryInputSchema>;
export type CreateJournalEntryResponse = z.infer<typeof createJournalEntryResponseSchema>;
export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;
