import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { updateArPaymentInputSchema } from '@/types/api';
import { postArPaymentIfNeeded } from '@/lib/payment-posting';
import { syncArPaymentSettlement } from '@/lib/settlement-status';
import { routeForApproval } from '@/lib/approval/engine';
import { normalizeArPaymentAccount } from '@/lib/ar-payment-input';

export const runtime = 'nodejs';
import { assertPaymentEditable, lockPayment, validatePaymentAllocations } from '@/lib/payment-validation';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const payment = await prisma.aRPayment.findFirst({
      where: { id, organizationId: orgId },
      include: { customer: true, allocations: true },
    });
    if (!payment) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(payment));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const PUT = withPermission({ module: 'AR_PAYMENTS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }
  try {
    const body = await req.json();
    const parsed = updateArPaymentInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid AR payment payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { allocations, ...data } = normalizeArPaymentAccount(parsed.data);
    const payment = await prisma.$transaction(async (tx) => {
      await lockPayment(tx, orgId, 'ar', id);
      const existing = await tx.aRPayment.findFirst({ where: { id, organizationId: orgId }, include: { customer: true, allocations: true } });
      if (!existing) return null;
      assertPaymentEditable(existing, { ...data, ...(allocations !== undefined ? { allocations } : {}) });
      if (existing.journalEntryId || (existing.status !== 'DRAFT' && !(existing.status === 'PROCESSING' && data.status === 'COMPLETED'))) return existing;
      await validatePaymentAllocations(tx, orgId, 'ar', { ...existing, ...data, allocations: allocations ?? existing.allocations });
      if (data.customerId) {
        await validateForeignKey(tx.customer, { id: data.customerId, organizationId: orgId, status: 'ACTIVE' }, 'Customer not found in organization');
      }
      if (allocations) {
        for (const allocation of allocations) {
          await validateForeignKey(tx.salesInvoice, { id: allocation.invoiceId, organizationId: orgId }, 'Invoice not found in organization');
        }
      }
      await tx.aRPayment.update({
        where: { id, organizationId: orgId },
        data: { ...data, ...(data.date && { date: new Date(data.date) }), updatedAt: new Date() },
      });
      // Invoices this payment used to settle must be re-derived too, so one
      // that loses its allocation falls back out of PAID.
      const previousAllocations = await tx.aRPaymentAllocation.findMany({
        where: { paymentId: id },
        select: { invoiceId: true },
      });
      if (allocations) {
        await tx.aRPaymentAllocation.deleteMany({ where: { paymentId: id } });
        if (allocations.length > 0) {
          await tx.aRPaymentAllocation.createMany({
            data: allocations.map((allocation) => ({
              ...allocation,
              paymentId: id,
            })),
          });
        }
      }
      // A DRAFT payment completed via this update posts to the GL now;
      // already-posted payments are a no-op (journalEntryId token). When this
      // update is the finalize transition (the payment was not yet posted and
      // is now in a postable status), the approval engine may hold it first.
      const effectiveStatus = (data.status ?? existing.status) as string;
      const nowPostable = effectiveStatus === 'COMPLETED';
      const isFinalizeTransition = nowPostable;

      if (isFinalizeTransition) {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'AR_PAYMENT',
          documentId: id,
        });
        if (routed) {
          // HELD for approval: stamp PENDING_APPROVAL and post NO GL.
          await tx.aRPayment.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          await postArPaymentIfNeeded(tx, orgId, id, dateOverride);
        }
      } else {
        await postArPaymentIfNeeded(tx, orgId, id, dateOverride);
      }

      await syncArPaymentSettlement(tx, orgId, id, previousAllocations.map((a) => a.invoiceId));

      return tx.aRPayment.findFirst({
        where: { id, organizationId: orgId },
        include: { customer: true, allocations: true },
      });
    });
    if (!payment) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(payment));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AR_PAYMENTS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.$transaction(async tx => {
      await lockPayment(tx, orgId, 'ar', id);
      const existing = await tx.aRPayment.findFirst({ where: { id, organizationId: orgId }, select: { status: true, journalEntryId: true } });
      if (!existing) throw new ApiError('Not found', 404);
      if (existing.status !== 'DRAFT' || existing.journalEntryId) throw new ApiError('Only draft payments can be deleted; posted payments must be voided', 422);
      await tx.aRPayment.delete({ where: { id, organizationId: orgId } });
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    if (error instanceof ApiError) return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
