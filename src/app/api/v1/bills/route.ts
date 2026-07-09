// Bill model: number, vendorId, issueDate, dueDate, status (BillStatus), totalAmount
// BillStatus: DRAFT | OPEN | PENDING | PAID | OVERDUE | VOID
// BillLine fields: billId, lineNo, description, quantity, unit, price, lineTotal
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { billInputSchema } from '@/types/api';
import { createBillRecord } from '@/lib/bills';
import { postBillToLedger } from '@/lib/bill-posting';
import { applyBillPoReceipt } from '@/lib/bill-po-receipt';
import { assertPeriodOpen } from '@/lib/period-guard';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

// A bill must carry a supplier invoice # (No. Faktur) before it can post, so the
// same physical supplier invoice can't be billed twice (enforced by the
// per-vendor unique index on vendorInvoiceNo).
const POSTING_STATUSES = new Set(['APPROVED', 'OPEN']);

function isFakturDuplicate(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('vendorInvoiceNo') : String(target ?? '').includes('vendorInvoiceNo');
}

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

export const POST = withPermission({ module: 'AP_BILLS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);
  const body = await req.json();
  const parsed = billInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid bill payload', 400);
  }

  if (POSTING_STATUSES.has(parsed.data.status as string) && !parsed.data.vendorInvoiceNo) {
    return err('Supplier invoice # (No. Faktur) is required to approve a bill.', 400);
  }

  let bill;
  try {
    bill = await prisma.$transaction(async (tx: any) => {
    const createdBill = await createBillRecord(tx, orgId, parsed.data);

    // --- PO line qty tracking: VALIDATE + LINK at create time ---
    // Lines pulled from an existing goods receipt (alreadyReceived) bill stock
    // that was already received — they must NOT re-increment receivedQty. Only
    // lines that both link a PO and represent a fresh receipt drive receivedQty.
    //
    // The receivedQty INCREMENT + PO status flip is deferred to the FINALIZE
    // path (applyBillPoReceipt) so a bill held for approval — or later rejected —
    // never mutates the PO. Here we only do the read-only over-receive check and
    // persist the bill-line -> PO-line link so the finalizer can read it back.
    if (parsed.data.lines && parsed.data.lines.length > 0) {
      const linesWithPO = parsed.data.lines.filter(l => l.purchaseOrderLineId && !l.alreadyReceived);
      for (const line of linesWithPO) {
        // Validate: PO line belongs to this org + no over-receiving (read-only).
        const poLine = await tx.purchaseOrderLine.findUnique({
          where: { id: line.purchaseOrderLineId },
          select: {
            id: true,
            quantity: true,
            receivedQty: true,
            purchaseOrder: { select: { organizationId: true } },
          },
        });
        // Reject a missing OR cross-org PO line with the SAME generic 4xx, BEFORE
        // the over-receive branch below — so the response never reveals another
        // org's line, nor leaks its ordered/received quantities.
        if (!poLine || poLine.purchaseOrder.organizationId !== orgId) {
          throw new ApiError('PO line not found in organization', 422);
        }
        const newTotal = Number(poLine.receivedQty) + Number(line.quantity);
        if (newTotal > Number(poLine.quantity) + 0.0001) {
          throw new ApiError(`Over-receiving: PO line allows ${Number(poLine.quantity) - Number(poLine.receivedQty)} more units`, 422);
        }
        // Link the created bill line to the PO line (createBillRecord already
        // persists this, but keep the explicit link so the relationship is
        // guaranteed regardless of how the line was created).
        const billLine = createdBill!.lines?.find((bl: any) => bl.lineNo === line.lineNo);
        if (billLine && !billLine.purchaseOrderLineId) {
          await tx.billLine.update({
            where: { id: billLine.id },
            data: { purchaseOrderLineId: line.purchaseOrderLineId },
          });
        }
      }
    }

    // Post inventory + GL when the bill is created already finalized,
    // unless the approval engine routes the finalize for approval first.
    const billStatus = parsed.data.status as string;
    if ((billStatus === 'APPROVED' || billStatus === 'OPEN') && createdBill) {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'BILL',
        documentId: createdBill.id,
      });
      if (routed) {
        // HELD for approval: createBillRecord stamped the live status above;
        // override it back to PENDING_APPROVAL, apply NO PO receipt, post NO GL
        // (skip assertPeriodOpen). The PO receipt happens on approval (finalizer).
        await tx.bill.update({
          where: { id: createdBill.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
        (createdBill as any).status = 'PENDING_APPROVAL';
      } else {
        // Finalized directly. Apply the PO receipt FIRST (before postBillToLedger
        // books the inventory lots applyBillPoReceipt uses to detect an already-
        // booked goods receipt), then post GL into an open accounting period.
        await applyBillPoReceipt(tx, orgId, createdBill.id);
        await assertPeriodOpen(
          tx,
          orgId,
          createdBill.issueDate ? new Date(createdBill.issueDate) : new Date(),
        );
        await postBillToLedger(tx, orgId, createdBill as any);
      }
    }
    return createdBill;
    });
  } catch (error) {
    if (isFakturDuplicate(error)) {
      return err(`Supplier invoice # "${parsed.data.vendorInvoiceNo}" is already recorded for this vendor.`, 409);
    }
    throw error;
  }

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
