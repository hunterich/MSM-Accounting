import { z } from 'zod';

export const AccountRow = z.object({
  code: z.string().min(1), name: z.string().min(1),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  parentCode: z.string().optional(),
});
export const CustomerRow = z.object({
  name: z.string().min(1), email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(), address: z.string().optional(), npwp: z.string().optional(),
});
export const VendorRow = z.object({
  name: z.string().min(1), email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(), address: z.string().optional(), npwp: z.string().optional(),
});
export const ItemRow = z.object({
  name: z.string().min(1), sku: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE', 'RAW_MATERIAL']).optional().default('PRODUCT'),
  unit: z.string().optional().default('PCS'),
  salePrice: z.coerce.number().min(0).optional().default(0),
  purchasePrice: z.coerce.number().min(0).optional().default(0),
  openingStock: z.coerce.number().min(0).optional().default(0),
  openingValue: z.coerce.number().min(0).optional().default(0),
});
export const OpeningJournalRow = z.object({
  accountCode: z.string().min(1),
  debit: z.coerce.number().min(0).optional().default(0),
  credit: z.coerce.number().min(0).optional().default(0),
});
export const OpeningInvoiceRow = z.object({
  customerName: z.string().min(1), invoiceNumber: z.string().optional(),
  issueDate: z.string().min(1), dueDate: z.string().optional(),
  amount: z.coerce.number().min(0),
});
export const OpeningBillRow = z.object({
  vendorName: z.string().min(1), billNumber: z.string().optional(),
  issueDate: z.string().min(1), dueDate: z.string().optional(),
  amount: z.coerce.number().min(0),
});

export const MIGRATION_ENTITIES = [
  'accounts', 'customers', 'vendors', 'items',
  'opening-journal', 'opening-invoices', 'opening-bills',
] as const;
export type MigrationEntity = (typeof MIGRATION_ENTITIES)[number];

export const ENTITY_SCHEMA: Record<MigrationEntity, z.ZodTypeAny> = {
  accounts: AccountRow, customers: CustomerRow, vendors: VendorRow, items: ItemRow,
  'opening-journal': OpeningJournalRow, 'opening-invoices': OpeningInvoiceRow,
  'opening-bills': OpeningBillRow,
};

export function validateRows(entity: MigrationEntity, rows: unknown[]) {
  const schema = ENTITY_SCHEMA[entity];
  const valid: unknown[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const r = schema.safeParse(row);
    if (r.success) valid.push(r.data);
    else errors.push({ row: i + 2, message: r.error.issues.map((x) => x.message).join('; ') });
  });
  return { valid, errors };
}
