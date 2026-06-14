// POST /api/v1/purchase-orders/[id]/receive
// Body: { lines: [{ purchaseOrderLineId, qtyReceived }], notes? }
// Creates a draft Bill pre-filled with the received lines. Returns { billId }.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, requireOrg, nextNumber, withHandler } from '@/lib/api-utils';
import { asMoney } from '@/lib/money';
import { postGoodsReceiptToLedger } from '@/lib/goods-receipt-posting';
import { assertPeriodOpen } from '@/lib/period-guard';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const body = await req.json();
  const { lines, notes } = body as {
    lines: { purchaseOrderLineId: string; qtyReceived: number }[];
    notes?: string;
  };

  if (!lines || lines.length === 0) {
    return err('lines is required', 400);
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    include: { vendor: true, lines: true },
  });
  if (!po) return err('Purchase order not found', 404);
  if (!['APPROVED', 'PARTIAL_RECEIVED'].includes(po.status)) {
    return err('PO must be APPROVED or PARTIAL_RECEIVED to receive goods', 422);
  }

  const rate = po.taxable ? Number(po.taxRate) / 100 : 0;

  const billNumber = await nextNumber(prisma, 'Bill', 'number', 'BILL');

  const receiptDate = new Date();

  const bill = await prisma.$transaction(async (tx) => {
    // Refuse to receive into a closed/locked accounting period.
    await assertPeriodOpen(tx, orgId, receiptDate);

    // Validate and build bill lines
    const billLinesData: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      const { purchaseOrderLineId, qtyReceived } = lines[i];
      const poLine = await tx.purchaseOrderLine.findUnique({
        where: { id: purchaseOrderLineId },
        select: { id: true, quantity: true, receivedQty: true, purchaseOrderId: true, description: true, price: true, discountPct: true, unit: true, itemId: true },
      });
      if (!poLine) throw new ApiError(`PO line ${purchaseOrderLineId} not found`, 422);
      if (poLine.purchaseOrderId !== id) throw new ApiError('PO line does not belong to this PO', 422);
      const remaining = Number(poLine.quantity) - Number(poLine.receivedQty);
      if (qtyReceived > remaining + 0.0001) {
        throw new ApiError(`Over-receiving: only ${remaining.toFixed(4)} units remaining on line`, 422);
      }
      // Carry the PO line's discount onto the bill line; lineTotal is net of
      // discount so the GR/IR inventory cost basis reflects the discounted price.
      const disc = Number(poLine.discountPct) || 0;
      const lineTotal = Math.round(qtyReceived * Number(poLine.price) * (1 - disc / 100) * 100) / 100;
      billLinesData.push({
        lineNo: i + 1,
        itemId: poLine.itemId ?? null,
        description: poLine.description,
        quantity: qtyReceived,
        unit: poLine.unit ?? 'PCS',
        price: Number(poLine.price),
        discountPct: disc,
        lineTotal,
        purchaseOrderLineId,
      });
    }

    // Create the bill
    const created = await tx.bill.create({
      data: {
        organizationId: orgId,
        number: billNumber,
        vendorId: po.vendorId,
        poId: po.id,
        issueDate: receiptDate,
        status: 'DRAFT',
        taxRate: Number(po.taxRate),
        taxable: po.taxable,
        taxInclusive: po.taxInclusive,
        notes: notes ?? `Goods received from PO ${po.number}`,
        subtotal: asMoney(billLinesData.reduce((s, l) => s + (po.taxInclusive ? l.lineTotal / (1 + rate) : l.lineTotal), 0)),
        taxAmount: asMoney(billLinesData.reduce((s, l) => {
          const net = po.taxInclusive ? l.lineTotal / (1 + rate) : l.lineTotal;
          return s + (!po.taxable ? 0 : po.taxInclusive ? (l.lineTotal - net) : net * rate);
        }, 0)),
        totalAmount: asMoney(billLinesData.reduce((s, l) => {
          const net = po.taxInclusive ? l.lineTotal / (1 + rate) : l.lineTotal;
          const tax = !po.taxable ? 0 : po.taxInclusive ? (l.lineTotal - net) : net * rate;
          return s + (po.taxInclusive ? l.lineTotal : net + tax);
        }, 0)),
        lines: {
          create: billLinesData,
        },
      },
    });

    // Update receivedQty on each PO line
    for (const line of lines) {
      await tx.purchaseOrderLine.update({
        where: { id: line.purchaseOrderLineId },
        data: { receivedQty: { increment: line.qtyReceived } },
      });
    }

    // Update PO status
    const allPoLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: id },
      select: { quantity: true, receivedQty: true },
    });
    const allFull = allPoLines.every((pl: any) => Number(pl.receivedQty) >= Number(pl.quantity) - 0.0001);
    const anyReceived = allPoLines.some((pl: any) => Number(pl.receivedQty) > 0.0001);
    const newStatus = allFull ? 'CLOSED' : anyReceived ? 'PARTIAL_RECEIVED' : po.status;
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: newStatus as any },
    });

    // Inventory + GR/IR at receipt (net cost). Fails loud if the inventory
    // account is unconfigured, so cost layers and the GL never diverge.
    await postGoodsReceiptToLedger(tx, orgId, {
      billId: created.id,
      poNumber: po.number,
      date: receiptDate,
      taxInclusive: po.taxInclusive,
      taxRate: Number(po.taxRate),
      lines: billLinesData.map((l) => ({ itemId: l.itemId, quantity: l.quantity, lineTotal: l.lineTotal })),
    });

    return created;
  });

  return ok({ billId: bill.id, billNumber: bill.number }, 201);
});
