/**
 * Single source of truth for the migration wizard's per-entity target fields.
 *
 * Mirrors the backend Zod row schemas in `lib/migration/schemas.ts` — field
 * names and required/optional status here must stay in sync with that file.
 * Aliases are lower-cased header strings likely to appear in Accurate
 * exports (English + Bahasa Indonesia), used by later tasks for auto-mapping
 * uploaded columns to target fields.
 */

export type MigrationEntity =
  | 'accounts'
  | 'customers'
  | 'vendors'
  | 'items'
  | 'opening-journal'
  | 'opening-invoices'
  | 'opening-bills';

export interface FieldSpec {
  field: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const ENTITY_FIELDS: Record<MigrationEntity, FieldSpec[]> = {
  accounts: [
    {
      field: 'code',
      label: 'Account Code',
      required: true,
      aliases: ['code', 'account code', 'account no', 'no akun', 'no. akun', 'kode akun', 'kode'],
    },
    {
      field: 'name',
      label: 'Account Name',
      required: true,
      aliases: ['name', 'account name', 'nama', 'nama akun'],
    },
    {
      field: 'type',
      label: 'Account Type',
      required: true,
      aliases: ['type', 'account type', 'tipe', 'tipe akun', 'kategori'],
    },
    {
      field: 'parentCode',
      label: 'Parent Account Code',
      required: false,
      aliases: ['parent', 'parent code', 'parent account', 'induk', 'akun induk'],
    },
  ],
  customers: [
    {
      field: 'name',
      label: 'Customer Name',
      required: true,
      aliases: ['name', 'customer name', 'nama', 'nama pelanggan'],
    },
    {
      field: 'email',
      label: 'Email',
      required: false,
      aliases: ['email', 'e-mail'],
    },
    {
      field: 'phone',
      label: 'Phone',
      required: false,
      aliases: ['phone', 'telp', 'telepon', 'no hp', 'hp'],
    },
    {
      field: 'address',
      label: 'Address',
      required: false,
      aliases: ['address', 'alamat'],
    },
    {
      field: 'npwp',
      label: 'NPWP',
      required: false,
      aliases: ['npwp', 'tax id', 'tax no'],
    },
  ],
  vendors: [
    {
      field: 'name',
      label: 'Vendor Name',
      required: true,
      aliases: ['name', 'supplier name', 'vendor name', 'nama', 'nama pemasok'],
    },
    {
      field: 'email',
      label: 'Email',
      required: false,
      aliases: ['email', 'e-mail'],
    },
    {
      field: 'phone',
      label: 'Phone',
      required: false,
      aliases: ['phone', 'telp', 'telepon', 'no hp', 'hp'],
    },
    {
      field: 'address',
      label: 'Address',
      required: false,
      aliases: ['address', 'alamat'],
    },
    {
      field: 'npwp',
      label: 'NPWP',
      required: false,
      aliases: ['npwp', 'tax id', 'tax no'],
    },
  ],
  items: [
    {
      field: 'name',
      label: 'Item Name',
      required: true,
      aliases: ['name', 'item name', 'product', 'nama barang', 'nama'],
    },
    {
      field: 'sku',
      label: 'SKU',
      required: false,
      aliases: ['sku', 'code', 'item code', 'kode barang', 'kode'],
    },
    {
      field: 'type',
      label: 'Item Type',
      required: false,
      aliases: ['type', 'item type', 'tipe', 'tipe barang'],
    },
    {
      field: 'unit',
      label: 'Unit',
      required: false,
      aliases: ['unit', 'uom', 'satuan'],
    },
    {
      field: 'salePrice',
      label: 'Sale Price',
      required: false,
      aliases: ['sale price', 'selling price', 'price', 'harga jual'],
    },
    {
      field: 'purchasePrice',
      label: 'Purchase Price',
      required: false,
      aliases: ['purchase price', 'cost', 'cost price', 'harga beli', 'hpp'],
    },
    {
      field: 'openingStock',
      label: 'Opening Stock',
      required: false,
      aliases: ['opening stock', 'qty', 'quantity', 'stok awal', 'kuantitas', 'saldo qty'],
    },
    {
      field: 'openingValue',
      label: 'Opening Value',
      required: false,
      aliases: ['opening value', 'value', 'nilai', 'nilai awal', 'saldo nilai'],
    },
  ],
  'opening-journal': [
    {
      field: 'accountCode',
      label: 'Account Code',
      required: true,
      aliases: ['account code', 'account', 'no akun', 'kode akun', 'account no'],
    },
    {
      field: 'debit',
      label: 'Debit',
      required: false,
      aliases: ['debit', 'debet'],
    },
    {
      field: 'credit',
      label: 'Credit',
      required: false,
      aliases: ['credit', 'kredit'],
    },
  ],
  'opening-invoices': [
    {
      field: 'customerName',
      label: 'Customer Name',
      required: true,
      aliases: ['customer', 'customer name', 'pelanggan', 'nama pelanggan'],
    },
    {
      field: 'invoiceNumber',
      label: 'Invoice Number',
      required: false,
      aliases: ['invoice', 'invoice number', 'no invoice', 'no faktur', 'nomor'],
    },
    {
      field: 'issueDate',
      label: 'Issue Date',
      required: true,
      aliases: ['date', 'issue date', 'invoice date', 'tanggal', 'tgl', 'tanggal faktur'],
    },
    {
      field: 'dueDate',
      label: 'Due Date',
      required: false,
      aliases: ['due date', 'jatuh tempo', 'tgl jatuh tempo'],
    },
    {
      field: 'amount',
      label: 'Amount',
      required: true,
      aliases: ['amount', 'balance', 'outstanding', 'sisa', 'saldo', 'nilai'],
    },
  ],
  'opening-bills': [
    {
      field: 'vendorName',
      label: 'Vendor Name',
      required: true,
      aliases: ['vendor', 'supplier', 'supplier name', 'pemasok', 'nama pemasok'],
    },
    {
      field: 'billNumber',
      label: 'Bill Number',
      required: false,
      aliases: ['bill', 'bill number', 'invoice', 'no faktur', 'nomor'],
    },
    {
      field: 'issueDate',
      label: 'Issue Date',
      required: true,
      aliases: ['date', 'bill date', 'tanggal', 'tgl'],
    },
    {
      field: 'dueDate',
      label: 'Due Date',
      required: false,
      aliases: ['due date', 'jatuh tempo'],
    },
    {
      field: 'amount',
      label: 'Amount',
      required: true,
      aliases: ['amount', 'balance', 'outstanding', 'sisa', 'saldo', 'nilai'],
    },
  ],
};

export function requiredFields(entity: MigrationEntity): string[] {
  return ENTITY_FIELDS[entity].filter((spec) => spec.required).map((spec) => spec.field);
}
