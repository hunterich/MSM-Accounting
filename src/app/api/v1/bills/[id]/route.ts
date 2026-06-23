import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { updateBillInputSchema } from '@/types/api';
import { postBillToLedger } from '@/lib/bill-posting';
import { assertPeriodOpen } from '@/lib/period-guard';
import { routeForApproval } from '@/lib/approval/engine';

function isFakturDuplicate(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('vendorInvoiceNo') : String(target ?? '').includes('vendorInvoiceNo');
}

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const bill = await prisma.bill.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: true, lines: true, attachments: true },
    });
    if (!bill) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(bill));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }
  try {
    const body = await req.json();
    const parsed = updateBillInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid bill payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { lines, ...header } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.bill.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true, vendorInvoiceNo: true } });
      if (!existing) return null;
      if (existing.status !== 'DRAFT') {
        throw new ApiError('Only DRAFT bills can be modified', 403);
      }
      if (header.vendorId) {
        await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
      }
      if (header.poId) {
        await validateForeignKey(tx.purchaseOrder, { id: header.poId, organizationId: orgId }, 'Purchase order not found in organization');
      }
      // A bill can't be approved without a supplier invoice # (the per-vendor
      // duplicate guard). Honour either a value sent in this update or one already stored.
      if (existing.status === 'DRAFT' && header.status === 'OPEN') {
        const effectiveFaktur = header.vendorInvoiceNo !== undefined ? header.vendorInvoiceNo : existing.vendorInvoiceNo;
        if (!effectiveFaktur) {
          throw new ApiError('Supplier invoice # (No. Faktur) is required to approve a bill.', 400);
        }
      }
      await tx.bill.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          // Empty faktur # stores as NULL so the per-vendor unique index ignores it.
          ...(header.vendorInvoiceNo !== undefined && { vendorInvoiceNo: header.vendorInvoiceNo || null }),
          updatedAt: new Date(),
        },
      });
      if (lines) {
        await tx.billLine.deleteMany({ where: { billId: id } });
        await tx.billLine.createMany({
          data: lines.map((l, idx: number) => ({
            billId: id,
            itemId: l.itemId || null,
            accountId: l.accountId || null,
            purchaseOrderLineId: l.purchaseOrderLineId || null,
            lineNo: l.lineNo ?? idx + 1,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            price: l.price,
            lineTotal: l.lineTotal ?? (Number(l.quantity) * Number(l.price)),
          })),
        });
      }
      // Recognize GL + inventory when the bill is finalized (DRAFT -> OPEN),
      // unless the approval engine routes the finalize for approval first.
      if (existing.status === 'DRAFT' && header.status === 'OPEN') {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'BILL',
          documentId: id,
        });
        if (routed) {
          // HELD for approval: the header update above already stamped
          // status='OPEN'; override it back to PENDING_APPROVAL and post NO GL.
          await tx.bill.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          const finalized = await tx.bill.findFirst({
            where: { id, organizationId: orgId },
            include: { lines: true },
          });
          if (finalized) {
            // Refuse to post into a closed/locked accounting period (mirrors the
            // create-as-OPEN path in bills/route.ts).
            await assertPeriodOpen(tx, orgId, finalized.issueDate ? new Date(finalized.issueDate) : new Date());
            await postBillToLedger(tx, orgId, finalized as any);
          }
        }
      }
      return tx.bill.findFirst({
        where: { id, organizationId: orgId },
        include: { vendor: true, lines: true, attachments: true },
      });
    });
    if (!updated) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    if (isFakturDuplicate(error)) {
      return withCors(NextResponse.json({ error: 'Supplier invoice # is already recorded for this vendor.' }, { status: 409 }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const existing = await prisma.bill.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true } });
    if (!existing) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }
    if (existing.status !== 'DRAFT') {
      return withCors(NextResponse.json({ error: 'Only DRAFT bills can be deleted' }, { status: 403 }));
    }
    await prisma.bill.update({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
