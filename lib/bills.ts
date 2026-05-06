import type { Prisma } from '@prisma/client';
import { nextNumber, validateForeignKey } from '@/lib/api-utils';
import { asMoney, toNumber } from '@/lib/money';
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
        lineTotal: line.lineTotal != null
          ? asMoney(toNumber(line.lineTotal))
          : asMoney(toNumber(line.quantity) * toNumber(line.price)),
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
