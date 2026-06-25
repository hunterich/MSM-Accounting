import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { updatePurchaseOrderInputSchema } from '@/types/api';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: true, lines: true },
    });
    if (!po) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(po));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const PUT = withPermission({ module: 'AP_POS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }
  try {
    const body = await req.json();
    const parsed = updatePurchaseOrderInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid purchase order payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { lines, ...header } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true } });
      if (!existing) return null;
      if (header.vendorId) {
        await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
      }
      await tx.purchaseOrder.update({
        where: { id, organizationId: orgId },
        data: { ...header, updatedAt: new Date() },
      });

      // Auto-route the DRAFT → APPROVED finalize through the approval engine.
      // The header update above may have already stamped status='APPROVED';
      // if approval is required, hold the PO at PENDING_APPROVAL instead.
      if (existing.status === 'DRAFT' && header.status === 'APPROVED') {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'PURCHASE_ORDER',
          documentId: id,
        });
        if (routed) {
          await tx.purchaseOrder.update({
            where: { id },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
          // NOTE: intentionally no early return here. The PO is now held at
          // PENDING_APPROVAL, but we must still fall through to the line
          // replace/createMany block below so the user's edited line items are
          // saved on the held document. Returning early would silently drop edits.
        }
        // else: not required / already approved — keep APPROVED (POs post no GL).
      }
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((l, idx: number) => ({
            purchaseOrderId: id,
            itemId: l.itemId || null,
            accountId: l.accountId || null,
            lineNo: l.lineNo ?? idx + 1,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            price: l.price,
            lineTotal: l.lineTotal ?? (Number(l.quantity) * Number(l.price)),
          })),
        });
      }
      return tx.purchaseOrder.findFirst({
        where: { id, organizationId: orgId },
        include: { vendor: true, lines: true },
      });
    });
    if (!updated) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseOrder', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AP_POS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.purchaseOrder.delete({ where: { id, organizationId: orgId } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseOrder', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
