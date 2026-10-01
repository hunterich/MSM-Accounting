import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { updatePurchaseOrderInputSchema } from '@/types/api';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission } from '@/lib/authz';
import { assertItemsActive } from '@/lib/item-availability';
import { normalizePurchasePolicy } from '@/lib/organization/settings-config';
import { resolveAutoCloseOptions } from '@/lib/purchase-order-auto-close-config';
import { lockPurchaseOrder } from '@/lib/purchase-order-auto-close';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    // The list/edit links use the display id, which is the PO NUMBER; resolve
    // either the cuid or the number so edit-loading works from any entry point.
    const po = await prisma.purchaseOrder.findFirst({
      where: { organizationId: orgId, OR: [{ id }, { number: id }] },
      include: { vendor: true, lines: true, charges: true },
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
    const { lines, charges, ...header } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, id);
      const existing = await tx.purchaseOrder.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, status: true, autoCloseEnabled: true, autoCloseDays: true, lines: { select: { itemId: true, receivedQty: true } } },
      });
      if (!existing) return null;
      if (['CLOSED', 'CANCELLED'].includes(existing.status)) throw new ApiError('Closed or cancelled purchase orders cannot be modified', 422);
      if (existing.status === 'PARTIAL_RECEIVED' || existing.lines.some((line) => Number(line.receivedQty) > 0)) {
        if (lines || charges || Object.keys(header).some((key) => !['expectedDate', 'autoCloseEnabled', 'autoCloseDays'].includes(key))) {
          throw new ApiError('Received purchase orders can only change their expected delivery date and auto-close options', 422);
        }
      }
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { purchasePolicy: true } });
      const autoClose = resolveAutoCloseOptions(normalizePurchasePolicy(org?.purchasePolicy), header, existing);
      if (lines) {
        await assertItemsActive(tx, orgId, lines.map((line) => line.itemId), {
          allowItemIds: existing.lines.flatMap((line) => line.itemId ? [line.itemId] : []),
        });
      }
      if (header.vendorId) {
        await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
      }
      await tx.purchaseOrder.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          ...autoClose,
          // The schema validates YYYY-MM-DD strings; Prisma's DateTime needs a Date.
          ...(header.date && { date: new Date(header.date) }),
          ...(header.expectedDate !== undefined && { expectedDate: header.expectedDate ? new Date(header.expectedDate) : null }),
          updatedAt: new Date(),
        },
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
      if (charges) {
        await tx.purchaseOrderCharge.deleteMany({ where: { purchaseOrderId: id } });
        if (charges.length > 0) {
          await tx.purchaseOrderCharge.createMany({
            data: charges.map((c: any, idx: number) => ({
              purchaseOrderId: id,
              lineNo: c.lineNo ?? idx + 1,
              label: c.label,
              accountId: c.accountId || null,
              amount: c.amount ?? 0,
              taxRate: c.taxRate ?? 0,
            })),
          });
        }
      }
      return tx.purchaseOrder.findFirst({
        where: { id, organizationId: orgId },
        include: { vendor: true, lines: true, charges: true },
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
