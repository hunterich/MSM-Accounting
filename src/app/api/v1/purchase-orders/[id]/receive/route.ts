// POST /api/v1/purchase-orders/[id]/receive
// Body: { lines: [{ purchaseOrderLineId, qtyReceived }], notes? }
// Creates a draft Bill pre-filled with the received lines. Returns { billId }.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, requireOrg, nextNumber } from '@/lib/api-utils';
import { calculateBillAmounts } from '@/lib/bill-totals';
import { postGoodsReceiptToLedger } from '@/lib/goods-receipt-posting';
import { allocatePoReceiptLine, updatePoReceiptStatus } from '@/lib/po-receipt-amounts';
import { lockPurchaseOrder } from '@/lib/purchase-order-auto-close';
import { assertPeriodOpen } from '@/lib/period-guard';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { z } from 'zod';

export const runtime = 'nodejs';

const receiptSchema = z.object({
  lines: z.array(z.object({
    purchaseOrderLineId: z.string().min(1),
    qtyReceived: z.number().finite().positive(),
  })).min(1).refine(
    lines => new Set(lines.map(line => line.purchaseOrderLineId)).size === lines.length,
    'Each purchase order line may only appear once in a receipt',
  ),
  notes: z.string().optional(),
});

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'AP_POS', action: 'create' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orgId = requireOrg(req);

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const parsed = receiptSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);
  const { lines, notes } = parsed.data;

  const receiptDate = new Date();

  const bill = await prisma.$transaction(async (tx) => {
    // Use a fresh quantity and receipt history under the same lock as direct bills.
    await lockPurchaseOrder(tx, id);
    const po = await tx.purchaseOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!po) throw new ApiError('Purchase order not found', 404);
    if (!['APPROVED', 'PARTIAL_RECEIVED'].includes(po.status)) {
      throw new ApiError('PO must be APPROVED or PARTIAL_RECEIVED to receive goods', 422);
    }

    // Refuse to receive into a closed/locked accounting period.
    await assertPeriodOpen(tx, orgId, receiptDate, dateOverride);

    // Allocate the bill number INSIDE the transaction with `tx` so its advisory
    // lock stays held until the insert commits (calling it on the base `prisma`
    // client releases the lock before the insert → spurious 409s under load).
    const billNumber = await nextNumber(tx, 'Bill', 'number', 'BILL');

    // Validate and build bill lines
    const billLinesData = [];
    for (let i = 0; i < lines.length; i++) {
      const { purchaseOrderLineId, qtyReceived } = lines[i];
      const poLine = await tx.purchaseOrderLine.findUnique({
        where: { id: purchaseOrderLineId },
      });
      if (!poLine) throw new ApiError(`PO line ${purchaseOrderLineId} not found`, 422);
      if (poLine.purchaseOrderId !== id) throw new ApiError('PO line does not belong to this PO', 422);
      const amounts = await allocatePoReceiptLine(tx, orgId, po, poLine, qtyReceived);
      billLinesData.push({
        lineNo: i + 1,
        itemId: poLine.itemId ?? null,
        description: poLine.description,
        accountId: poLine.accountId,
        unit: poLine.unit ?? 'PCS',
        price: poLine.price,
        discountPct: poLine.discountPct,
        taxable: poLine.taxable,
        ...amounts,
        purchaseOrderLineId,
      });
    }

    const { subtotal, taxAmount, totalAmount } = calculateBillAmounts({ ...po, lines: billLinesData });
    // Create the bill
    const created = await tx.bill.create({
      data: {
        organizationId: orgId,
        number: billNumber,
        vendorId: po.vendorId,
        poId: po.id,
        issueDate: receiptDate,
        status: 'DRAFT',
        taxRate: po.taxRate,
        taxable: po.taxable,
        taxInclusive: po.taxInclusive,
        notes: notes ?? `Goods received from PO ${po.number}`,
        subtotal,
        taxAmount,
        totalAmount,
        lines: {
          create: billLinesData,
        },
      },
    });

    // Update receivedQty on each PO line
    for (const line of billLinesData) {
      await tx.purchaseOrderLine.update({
        where: { id: line.purchaseOrderLineId },
        data: { receivedQty: { increment: line.quantity } },
      });
    }

    await updatePoReceiptStatus(tx, orgId, id);

    // Inventory + GR/IR at receipt (net cost). Fails loud if the inventory
    // account is unconfigured, so cost layers and the GL never diverge.
    await postGoodsReceiptToLedger(tx, orgId, {
      billId: created.id,
      poNumber: po.number,
      date: receiptDate,
      taxInclusive: po.taxable && po.taxInclusive,
      taxRate: po.taxRate,
      lines: billLinesData,
    });

    return created;
  });

  return ok({ billId: bill.id, billNumber: bill.number }, 201);
});
