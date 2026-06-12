// Bill model: number, vendorId, issueDate, dueDate, status (BillStatus), totalAmount
// BillStatus: DRAFT | OPEN | PENDING | PAID | OVERDUE | VOID
// BillLine fields: billId, lineNo, description, quantity, unit, price, lineTotal
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { billInputSchema } from '@/types/api';
import { createBillRecord } from '@/lib/bills';
import { postBillToLedger } from '@/lib/bill-posting';
import { assertPeriodOpen } from '@/lib/period-guard';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const vendorId = searchParams.get('vendorId');

  const where: any = { organizationId: orgId, deletedAt: null };
  if (status) where.status = status;
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { vendor: { name: { contains: search, mode: 'insensitive' } } },
  ];
  if (dateFrom || dateTo) {
    where.issueDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
    };
  }
  if (vendorId) where.vendorId = vendorId;

  const [data, total] = await Promise.all([
    prisma.bill.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { issueDate: 'desc' },
      include: { vendor: { select: { id: true, name: true, code: true } }, lines: true, attachments: true },
    }),
    prisma.bill.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = billInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid bill payload', 400);
  }

  const bill = await prisma.$transaction(async (tx: any) => {
    const createdBill = await createBillRecord(tx, orgId, parsed.data);

    // --- PO line qty tracking ---
    if (parsed.data.lines && parsed.data.lines.length > 0) {
      const linesWithPO = parsed.data.lines.filter(l => l.purchaseOrderLineId);
      if (linesWithPO.length > 0) {
        // Validate: no over-receiving
        for (const line of linesWithPO) {
          const poLine = await tx.purchaseOrderLine.findUnique({
            where: { id: line.purchaseOrderLineId },
            select: { id: true, quantity: true, receivedQty: true, purchaseOrderId: true },
          });
          if (!poLine) throw new ApiError(`PO line ${line.purchaseOrderLineId} not found`, 422);
          const newTotal = Number(poLine.receivedQty) + Number(line.quantity);
          if (newTotal > Number(poLine.quantity) + 0.0001) {
            throw new ApiError(`Over-receiving: PO line allows ${Number(poLine.quantity) - Number(poLine.receivedQty)} more units`, 422);
          }
          // Increment receivedQty
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: { receivedQty: { increment: Number(line.quantity) } },
          });
          // Link the created bill line to the PO line
          const billLine = createdBill!.lines?.find((bl: any) => bl.lineNo === line.lineNo);
          if (billLine) {
            await tx.billLine.update({
              where: { id: billLine.id },
              data: { purchaseOrderLineId: line.purchaseOrderLineId },
            });
          }
        }
        // Check PO completion and update status
        const firstPoLineId = linesWithPO[0].purchaseOrderLineId;
        const firstPoLine = await tx.purchaseOrderLine.findUnique({
          where: { id: firstPoLineId },
          select: { purchaseOrderId: true },
        });
        if (firstPoLine) {
          const allPoLines = await tx.purchaseOrderLine.findMany({
            where: { purchaseOrderId: firstPoLine.purchaseOrderId },
            select: { quantity: true, receivedQty: true },
          });
          const allFull = allPoLines.every((pl: any) => Number(pl.receivedQty) >= Number(pl.quantity) - 0.0001);
          const anyReceived = allPoLines.some((pl: any) => Number(pl.receivedQty) > 0.0001);
          const newPoStatus = allFull ? 'CLOSED' : anyReceived ? 'PARTIAL_RECEIVED' : undefined;
          if (newPoStatus) {
            await tx.purchaseOrder.update({
              where: { id: firstPoLine.purchaseOrderId },
              data: { status: newPoStatus as any },
            });
          }
        }
      }
    }

    // Post inventory + GL when the bill is created already finalized.
    const billStatus = parsed.data.status as string;
    if ((billStatus === 'APPROVED' || billStatus === 'OPEN') && createdBill) {
      // Refuse to post into a closed/locked accounting period.
      await assertPeriodOpen(
        tx,
        orgId,
        createdBill.issueDate ? new Date(createdBill.issueDate) : new Date(),
      );
      await postBillToLedger(tx, orgId, createdBill as any);
    }
    return createdBill;
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Bill',
    entityId: bill!.id,
    action: 'CREATE',
    payload: { number: bill!.number },
  });
  return ok(bill, 201);
});
