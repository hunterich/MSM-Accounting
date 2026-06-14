import { Prisma } from '@prisma/client';
import { nextNumber, validateForeignKey } from '@/lib/api-utils';
import type { BillInput } from '@/types/api';

type CreateBillOptions = {
  attachment?: {
    fileName: string;
    fileSizeKb?: number | null;
    mimeType?: string | null;
    storageKey?: string | null;
  };
};

type BillTransactionClient = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

// Coerce a zod-validated input value (number, numeric string, or already a
// Decimal) into a Prisma.Decimal. Returns ZERO for null/undefined/empty so
// the caller doesn't have to guard each field.
function toDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value === null || value === undefined || value === '') return ZERO;
  try {
    const d = new Prisma.Decimal(value as Prisma.Decimal.Value);
    return d.isFinite() ? d : ZERO;
  } catch {
    return ZERO;
  }
}

// Compute lineTotal as a Decimal, net of any per-line discount percent.
// Quantity is stored at 4dp in the DB and price at 2dp; the result is rounded
// to 2dp to match BillLine.lineTotal's column precision. lineTotal is the
// net-of-discount value the GR/IR posting uses as the inventory cost basis.
function computeLineTotal(quantity: unknown, price: unknown, discountPct: unknown = 0): Prisma.Decimal {
  const factor = new Prisma.Decimal(1).minus(toDecimal(discountPct).dividedBy(100));
  return toDecimal(quantity)
    .mul(toDecimal(price))
    .mul(factor)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export async function createBillRecord(
  tx: BillTransactionClient,
  orgId: string,
  input: BillInput,
  options: CreateBillOptions = {},
) {
  const { lines, ...header } = input;
  const number = await nextNumber(tx, 'Bill', 'number', 'BILL');

  await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');

  if (header.poId) {
    await validateForeignKey(
      tx.purchaseOrder,
      { id: header.poId, organizationId: orgId },
      'Purchase order not found in organization',
    );
  }

  const created = await tx.bill.create({
    data: {
      ...header,
      // zod validates YYYY-MM-DD strings; Prisma DateTime columns need Date objects.
      issueDate: new Date(header.issueDate),
      dueDate: header.dueDate ? new Date(header.dueDate) : null,
      // Empty supplier-invoice numbers must store as NULL so the per-vendor unique
      // index allows multiple bills without a faktur # (Postgres unique ignores NULLs).
      vendorInvoiceNo: header.vendorInvoiceNo && header.vendorInvoiceNo.length > 0 ? header.vendorInvoiceNo : null,
      organizationId: orgId,
      number,
    },
  });

  if (lines && lines.length > 0) {
    // Explicit field mapping (no spread): keeps transient inputs like
    // `alreadyReceived` out of the BillLine insert.
    await tx.billLine.createMany({
      data: lines.map((line, index) => ({
        billId: created.id,
        lineNo: line.lineNo ?? index + 1,
        itemId: line.itemId || null,
        accountId: line.accountId || null,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
        description: line.description,
        unit: line.unit || 'PCS',
        quantity: toDecimal(line.quantity),
        price: toDecimal(line.price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        discountPct: toDecimal(line.discountPct).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        lineTotal: line.lineTotal != null
          ? toDecimal(line.lineTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          : computeLineTotal(line.quantity, line.price, line.discountPct),
      })),
    });
  }

  if (options.attachment) {
    await tx.billAttachment.create({
      data: {
        billId: created.id,
        fileName: options.attachment.fileName,
        fileSizeKb: options.attachment.fileSizeKb ?? null,
        mimeType: options.attachment.mimeType ?? null,
        storageKey: options.attachment.storageKey ?? null,
      },
    });
  }

  return tx.bill.findUnique({
    where: { id: created.id },
    include: {
      vendor: true,
      lines: true,
      attachments: true,
    },
  });
}
