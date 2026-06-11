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

// Compute lineTotal as a Decimal. Quantity is stored at 4dp in the DB and
// price at 2dp; the product is rounded to 2dp to match BillLine.lineTotal's
// column precision and prevent the DB driver from silently truncating.
function computeLineTotal(quantity: unknown, price: unknown): Prisma.Decimal {
  return toDecimal(quantity)
    .mul(toDecimal(price))
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
      organizationId: orgId,
      number,
    },
  });

  if (lines && lines.length > 0) {
    await tx.billLine.createMany({
      data: lines.map((line, index) => ({
        ...line,
        billId: created.id,
        lineNo: line.lineNo ?? index + 1,
        itemId: line.itemId || null,
        accountId: line.accountId || null,
        quantity: toDecimal(line.quantity),
        price: toDecimal(line.price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        lineTotal: line.lineTotal != null
          ? toDecimal(line.lineTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          : computeLineTotal(line.quantity, line.price),
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
