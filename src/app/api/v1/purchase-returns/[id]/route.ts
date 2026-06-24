import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { routeForApproval } from '@/lib/approval/engine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const pr = await prisma.purchaseReturn.findFirst({
      where: { id, organizationId: orgId },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        bill: { select: { id: true, number: true, lines: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    });
    if (!pr) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(pr));
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
    const { lines, ...header } = body;

    const pr = await prisma.$transaction(async (tx) => {
      const prior = await tx.purchaseReturn.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, status: true, journalEntryId: true },
      });
      if (!prior) {
        throw new Error('Purchase return not found');
      }

      const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1 && lines === undefined;
      if (prior.status !== 'DRAFT' && !isStatusOnlyUpdate) {
        throw new Error('Only DRAFT purchase returns can be modified');
      }

      if (lines) {
        await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
      }

      const updated = await tx.purchaseReturn.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          ...(header.returnDate && { returnDate: new Date(header.returnDate) }),
          ...(header.subtotal != null    && { subtotal:    Number(header.subtotal) }),
          ...(header.taxAmount != null   && { taxAmount:   Number(header.taxAmount) }),
          ...(header.totalAmount != null && { totalAmount: Number(header.totalAmount) }),
          updatedAt: new Date(),
          ...(lines ? {
            lines: {
              create: lines.map((l: { lineKey?: string; itemId?: string; description?: string; qtyPurchased?: number; qtyReturn?: number; unit?: string; price?: number; lineTotal?: number }, idx: number) => ({
                lineNo:       idx + 1,
                lineKey:      l.lineKey || null,
                itemId:       l.itemId || null,
                description:  l.description || '',
                qtyPurchased: Number(l.qtyPurchased ?? 0),
                qtyReturn:    Number(l.qtyReturn ?? 0),
                unit:         l.unit || 'PCS',
                price:        Number(l.price ?? 0),
                lineTotal:    Number(l.lineTotal ?? 0),
              })),
            },
          } : {}),
        },
        include: { lines: true },
      });

      // Post on DRAFT → APPROVED transition (idempotent via journalEntryId),
      // unless the approval engine routes the finalize for approval first. The update
      // above may have already stamped status='APPROVED'; if approval is required,
      // hold the return at PENDING_APPROVAL and post NO GL.
      if (prior.status === 'DRAFT' && updated.status === 'APPROVED' && !prior.journalEntryId) {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'PURCHASE_RETURN',
          documentId: id,
        });
        if (routed) {
          await tx.purchaseReturn.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          await postPurchaseReturnOnApproval(tx, id);
        }
      }

      return tx.purchaseReturn.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
    });

    logAudit({ orgId, actorId: userId, entityType: 'PurchaseReturn', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(pr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
      await tx.purchaseReturn.delete({ where: { id, organizationId: orgId } });
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseReturn', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
