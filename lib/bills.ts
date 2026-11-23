import type { Prisma } from '@prisma/client';
import { nextNumber, validateForeignKey } from '@/lib/api-utils';
import type { BillInput } from '@/types/api';
import { prepareAssetLines } from './asset-purchases';
import { assertDocumentOffsetAccounts } from './document-offset-accounts';
import { calculateBillAmounts, normalizeBillLineAmounts } from './bill-totals';
import { roundMoneyDecimal } from './money-decimal';

type CreateBillOptions = {
  preserveSupplierTotals?: boolean;
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
  const { lines, charges, ...header } = input;
  const number = await nextNumber(tx, 'Bill', 'number', 'BILL');

  await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');

  if (header.poId) {
    await validateForeignKey(
      tx.purchaseOrder,
      { id: header.poId, organizationId: orgId },
      'Purchase order not found in organization',
    );
  }

  // Every bill line that carries a PO-line ref must point at a PurchaseOrderLine
  // owned by THIS org. PurchaseOrderLine has no organizationId column, so scope
  // through its parent PurchaseOrder. This is the authoritative chokepoint: it
  // covers ALL lines (including `alreadyReceived` ones, which the POST route's
  // over-receive loop skips), so a cross-org purchaseOrderLineId can never be
  // persisted verbatim on a BillLine and later leaked/mutated.
  for (const line of lines ?? []) {
    if (line.purchaseOrderLineId) {
      await validateForeignKey(
        tx.purchaseOrderLine,
        { id: line.purchaseOrderLineId, purchaseOrder: { organizationId: orgId } },
        'Purchase order line not found in organization',
      );
    }
  }

  // Resolve inherited charges before calculating the payable.
  let effectiveCharges: Array<{ lineNo?: number; label: string; accountId?: string | null; amount: Prisma.Decimal.Value; taxRate?: Prisma.Decimal.Value }> = charges ?? [];
  if (effectiveCharges.length === 0 && header.poId) {
    const poCharges = await tx.purchaseOrderCharge.findMany({ where: { purchaseOrderId: header.poId }, orderBy: { lineNo: 'asc' } });
    effectiveCharges = poCharges.map(({ label, accountId, amount, taxRate }) => ({ label, accountId, amount, taxRate }));
  }
  const amounts = calculateBillAmounts({
    ...header,
    lines: lines.map(line => ({
      ...normalizeBillLineAmounts(line.assetPurchase ? { ...line, lineTotal: undefined } : line),
      taxable: line.taxable,
    })),
    charges: effectiveCharges,
  });
  const { subtotal, taxAmount, withholdingAmount, totalAmount } = amounts;
  const created = await tx.bill.create({
    data: {
      ...header,
      ...(options.preserveSupplierTotals ? {} : { subtotal, taxAmount, withholdingAmount, totalAmount }),
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
    const preparedLines = await prepareAssetLines(tx, orgId, created.id, lines, header);
    await assertDocumentOffsetAccounts(tx, orgId, preparedLines.map(line => line.accountId));
    // Explicit field mapping (no spread): keeps transient inputs like
    // `alreadyReceived` out of the BillLine insert.
    await tx.billLine.createMany({
      data: preparedLines.map((line, index) => ({
        billId: created.id,
        lineNo: line.lineNo ?? index + 1,
        itemId: line.itemId || null,
        accountId: line.accountId || null,
        assetId: 'assetId' in line ? line.assetId as string : null,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
        description: line.description,
        unit: line.unit || 'PCS',
        taxable: line.taxable,
        ...normalizeBillLineAmounts(line),
      })),
    });
  }

  if (effectiveCharges.length > 0) {
    await assertDocumentOffsetAccounts(tx, orgId, effectiveCharges.map(charge => charge.accountId));
    await tx.billCharge.createMany({
      data: effectiveCharges.map((charge, index) => ({
        billId: created.id,
        lineNo: charge.lineNo ?? index + 1,
        label: charge.label,
        accountId: charge.accountId || null,
        amount: roundMoneyDecimal(charge.amount),
        taxRate: roundMoneyDecimal(charge.taxRate ?? 0),
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
      lines: { include: { asset: true } },
      charges: true,
      attachments: true,
    },
  });
}
