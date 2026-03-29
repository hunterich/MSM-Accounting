/**
 * Zod schemas for all 16 form pages.
 *
 * Usage:
 *   import { vendorSchema, type VendorFormData, zodToFormErrors } from '../utils/formSchemas';
 *
 *   // Replace manual interface:
 *   type FormData = VendorFormData;           // z.infer<typeof vendorSchema>
 *
 *   // Replace manual nextErrors block:
 *   const result = vendorSchema.safeParse(formData);
 *   if (!result.success) { setErrors(zodToFormErrors(result.error)); return; }
 */

import { z } from 'zod';

// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Converts a ZodError into a flat Record<fieldName, errorMessage> suitable
 * for storing in a React `useState({})` errors object.
 */
export const zodToFormErrors = (error: z.ZodError): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const issue of error.issues) {
        const key = issue.path.join('.') || '_root';
        if (!result[key]) result[key] = issue.message;
    }
    return result;
};

// ── Vendors (AP) ─────────────────────────────────────────────────────────────

export const vendorSchema = z.object({
    name:               z.string().min(1, 'Vendor name is required.'),
    category:           z.string().min(1, 'Category is required.'),
    defaultApAccountId: z.string().min(1, 'Default A/P account is required.'),
    code:               z.string().optional(),
    email:              z.string().optional(),
    phone:              z.string().optional(),
    paymentTerms:       z.string().optional(),
    npwp:               z.string().optional(),
    status:             z.string().optional(),
});
export type VendorFormData = z.infer<typeof vendorSchema>;

// ── Customers (AR) ───────────────────────────────────────────────────────────

export const customerSchema = z.object({
    name:                z.string().min(1, 'Customer name is required.'),
    category:            z.string().min(1, 'Category is required.'),
    id:                  z.string().optional(),
    code:                z.string().optional(),
    email:               z.string().optional(),
    phone:               z.string().optional(),
    website:             z.string().optional(),
    paymentTerms:        z.string().optional(),
    defaultDiscount:     z.number().optional(),
    creditLimit:         z.number().optional(),
    useCategoryDefaults: z.boolean().optional(),
    address1:            z.string().optional(),
    city:                z.string().optional(),
    province:            z.string().optional(),
    contactPerson:       z.string().optional(),
    taxable:             z.boolean().optional(),
    initialBalance:      z.number().optional(),
    status:              z.string().optional(),
});
export type CustomerFormData = z.infer<typeof customerSchema>;

// ── Bills (AP) ───────────────────────────────────────────────────────────────

export const billLineItemSchema = z.object({
    id:          z.union([z.string(), z.number()]),
    description: z.string(),
    accountId:   z.string().min(1, 'Each line must have an expense/asset account.'),
    qty:         z.number(),
    unit:        z.string(),
    price:       z.number(),
});

export const billSchema = z.object({
    vendor:      z.string().min(1, 'Vendor is required.'),
    apAccountId: z.string().min(1, 'A/P account is required.'),
    poNumber:    z.string().optional(),
    issueDate:   z.string().optional(),
    dueDate:     z.string().optional(),
    billNumber:  z.string().optional(),
    notes:       z.string().optional(),
}).extend({
    items: z.array(billLineItemSchema).min(1, 'Add at least one bill line.'),
});
export type BillFormData = z.infer<typeof billSchema>;

// ── Purchase Orders (AP) ──────────────────────────────────────────────────────

export const poLineItemSchema = z.object({
    id:          z.string(),
    accountId:   z.string(),
    description: z.string(),
    qty:         z.number(),
    unit:        z.string(),
    price:       z.number(),
});

export const poSchema = z.object({
    vendorId:     z.string().min(1, 'Vendor is required'),
    date:         z.string().min(1, 'Date is required'),
    id:           z.string().optional(),
    expectedDate: z.string().optional(),
    notes:        z.string().optional(),
}).extend({
    items: z.array(poLineItemSchema).min(1, 'At least one item is required'),
});
export type POFormData = z.infer<typeof poSchema>;

// ── Journal Entry (GL) ────────────────────────────────────────────────────────

export const jeLineSchema = z.object({
    id:          z.number(),
    accountId:   z.string(),
    description: z.string(),
    debit:       z.string(),
    credit:      z.string(),
});

export const journalEntryHeaderSchema = z.object({
    date:    z.string().min(1, 'Date is required.'),
    period:  z.string().min(1, 'Period is required.'),
    memo:    z.string().min(1, 'Memo / narration is required.'),
    entryNo: z.string().optional(),
    source:  z.string().optional(),
});
export type JEHeaderFormData = z.infer<typeof journalEntryHeaderSchema>;
export type JELineFormData   = z.infer<typeof jeLineSchema>;

// ── Employees (HR) ────────────────────────────────────────────────────────────

export const salaryLineItemSchema = z.object({
    id:     z.string(),
    name:   z.string(),
    amount: z.number(),
});

export const employeeSchema = z.object({
    name:                  z.string().min(1, 'Employee name is required.'),
    department:            z.string().min(1, 'Department is required.'),
    position:              z.string().min(1, 'Position is required.'),
    joinDate:              z.string().min(1, 'Join date is required.'),
    basicSalary:           z.number().min(0, 'Basic salary cannot be negative.'),
    id:                    z.string().optional(),
    ktp:                   z.string().optional(),
    dob:                   z.string().optional(),
    phone:                 z.string().optional(),
    email:                 z.string().optional(),
    address:               z.string().optional(),
    status:                z.string().optional(),
    type:                  z.string().optional(),
    bankName:              z.string().optional(),
    accountNumber:         z.string().optional(),
    accountHolder:         z.string().optional(),
    npwp:                  z.string().optional(),
    bpjsKesehatan:         z.string().optional(),
    bpjsKetenagakerjaan:   z.string().optional(),
    allowances:            z.array(salaryLineItemSchema).optional(),
    deductions:            z.array(salaryLineItemSchema).optional(),
});
export type EmployeeFormData = z.infer<typeof employeeSchema>;

// ── Inventory Items ───────────────────────────────────────────────────────────

const nonNegativeNumericString = (label: string) =>
    z.string().refine(
        (v) => v !== '' && !isNaN(Number(v)) && Number(v) >= 0,
        { message: `${label} must be a valid non-negative number.` }
    );

export const inventorySchema = z.object({
    name:               z.string().min(1, 'Item name is required.'),
    sku:                z.string().min(1, 'SKU is required.'),
    categoryId:         z.string().min(1, 'Category is required.'),
    price:              nonNegativeNumericString('Selling price'),
    cost:               nonNegativeNumericString('Cost price'),
    openingStock:       nonNegativeNumericString('Opening stock'),
    reorderPoint:       nonNegativeNumericString('Reorder point'),
    inventoryAccountId: z.string().min(1, 'Select an inventory account.'),
    revenueAccountId:   z.string().min(1, 'Select a revenue account.'),
    cogsAccountId:      z.string().min(1, 'Select a COGS account.'),
    // optional / non-validated fields
    skuManuallyEdited:         z.boolean().optional(),
    type:                      z.string().optional(),
    unit:                      z.string().optional(),
    purchaseUnit:               z.string().optional(),
    purchaseConversionFactor:   z.string().optional(),
    sellUnit:                   z.string().optional(),
    sellConversionFactor:       z.string().optional(),
    description:                z.string().optional(),
    barcode:                    z.string().optional(),
    weight:                     z.string().optional(),
    status:                     z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.purchaseUnit && (!data.purchaseConversionFactor || Number(data.purchaseConversionFactor) <= 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['purchaseConversionFactor'],
            message: 'Enter how many base units = 1 purchase unit.',
        });
    }
    if (data.sellUnit && (!data.sellConversionFactor || Number(data.sellConversionFactor) <= 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['sellConversionFactor'],
            message: 'Enter how many base units = 1 sell unit.',
        });
    }
});
export type InventoryFormData = z.infer<typeof inventorySchema>;

// ── Stock Adjustments ─────────────────────────────────────────────────────────

export const adjustmentLineSchema = z.object({
    id:        z.string(),
    itemId:    z.string(),
    accountId: z.string(),
    oldQty:    z.number(),
    newQty:    z.number(),
    qtyDiff:   z.number(),
    unitCost:  z.number(),
});

export const adjustmentSchema = z.object({
    date:   z.string().min(1, 'Date is required'),
    reason: z.string().min(1, 'Reason is required'),
    id:     z.string().optional(),
    type:   z.string().optional(),
    notes:  z.string().optional(),
    status: z.string().optional(),
}).extend({
    items: z.array(adjustmentLineSchema).min(1, 'At least one valid adjustment line is required'),
});
export type AdjustmentFormData = z.infer<typeof adjustmentSchema>;

// ── Banking Actions ───────────────────────────────────────────────────────────
// Conditional validation is applied via superRefine based on the action type
// (transfer | expense | income | account) which lives outside the formData object.

export const bankingFormSchema = z.object({
    fromAccountId:    z.string().optional(),
    toAccountId:      z.string().optional(),
    paidFromId:       z.string().optional(),
    expenseAccountId: z.string().optional(),
    payee:            z.string().optional(),
    depositToId:      z.string().optional(),
    incomeAccountId:  z.string().optional(),
    receivedFrom:     z.string().optional(),
    amount:           z.string().optional(),
    date:             z.string().optional(),
    reference:        z.string().optional(),
    description:      z.string().optional(),
    taxType:          z.string().optional(),
    taxRate:          z.string().optional(),
    costCenter:       z.string().optional(),
    notes:            z.string().optional(),
    accountNickname:  z.string().optional(),
    bankName:         z.string().optional(),
    last4:            z.string().optional(),
    openingBalance:   z.string().optional(),
    currency:         z.string().optional(),
});

/**
 * Returns a Zod schema with action-specific refinements applied.
 * Mirrors the `validate()` function in BankingActionForm exactly.
 */
export const bankingActionSchema = (action: string) =>
    bankingFormSchema.superRefine((data, ctx) => {
        const addError = (path: string, message: string) =>
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

        if (action === 'account') {
            if (!data.accountNickname?.trim()) addError('accountNickname', 'Account name is required.');
            const digits = data.last4?.replace(/\D/g, '') ?? '';
            if (digits.length > 0 && digits.length < 4) addError('last4', 'Enter at least the last 4 digits.');
            if (data.openingBalance !== '' && data.openingBalance != null) {
                const n = Number(data.openingBalance);
                if (isNaN(n) || n < 0) addError('openingBalance', 'Opening balance cannot be negative.');
            }
        } else {
            if (!data.amount || isNaN(Number(data.amount)) || Number(data.amount) <= 0)
                addError('amount', 'Enter a valid amount greater than 0.');
            if (!data.date) addError('date', 'Date is required.');
            if (data.taxType !== 'none') {
                const rate = Number(data.taxRate);
                if (isNaN(rate) || rate <= 0 || rate > 100) addError('taxRate', 'Tax rate must be between 0 and 100.');
            }
        }
        if (action === 'transfer') {
            if (!data.fromAccountId) addError('fromAccountId', 'Select a source account.');
            if (!data.toAccountId)   addError('toAccountId',   'Select a destination account.');
            if (data.fromAccountId && data.fromAccountId === data.toAccountId)
                addError('toAccountId', 'Source and destination must be different accounts.');
        }
        if (action === 'expense') {
            if (!data.paidFromId)       addError('paidFromId',       'Select the paying account.');
            if (!data.expenseAccountId) addError('expenseAccountId', 'Select an expense account.');
        }
        if (action === 'income') {
            if (!data.depositToId)      addError('depositToId',      'Select the receiving account.');
            if (!data.incomeAccountId)  addError('incomeAccountId',  'Select a revenue account.');
        }
    });

export type BankingFormData = z.infer<typeof bankingFormSchema>;

// ── Read-only / alert-based forms (types only, no field-level errors) ─────────
// These forms use window.alert() for validation and have no setErrors() state.
// Schemas are provided for type inference only.

export const billLineSchema = z.object({
    id:          z.union([z.string(), z.number()]),
    description: z.string(),
    accountId:   z.string(),
    qty:         z.number(),
    unit:        z.string(),
    price:       z.number(),
});

export const invoiceLineItemSchema = z.object({
    id:          z.union([z.string(), z.number()]),
    description: z.string(),
    accountId:   z.string().optional(),
    qty:         z.number(),
    unit:        z.string(),
    price:       z.number(),
    tax:         z.number().optional(),
});

export const salesReturnLineSchema = z.object({
    id:         z.string().optional(),
    itemName:   z.string(),
    qtyInvoice: z.number(),
    qtyReturn:  z.number(),
    unit:       z.string(),
    price:      z.number(),
});

export const purchaseReturnLineSchema = z.object({
    lineKey:    z.string().optional(),
    description: z.string(),
    qtyBill:    z.number(),
    qtyReturn:  z.number(),
    unit:       z.string(),
    price:      z.number(),
});

export const creditNoteLineSchema = z.object({
    itemId:    z.string().optional(),
    itemName:  z.string(),
    qtyReturn: z.number(),
    unit:      z.string(),
    price:     z.number(),
});

export const debitNoteLineSchema = z.object({
    lineKey:     z.string().optional(),
    description: z.string(),
    qtyReturn:   z.number(),
    unit:        z.string(),
    price:       z.number(),
});
