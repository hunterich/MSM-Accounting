import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit, logAuditTx, validateForeignKey } from '@/lib/api-utils';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { updatePurchaseReturnInputSchema } from '@/types/api';
import { ApiError } from '@/lib/errors';
import { lockReturnForDeletion, assertNoLinkedNotes } from '@/lib/return-deletion-guard';
import { lockPurchaseReturns, preparePurchaseReturnValuation } from '@/lib/purchase-return-amounts';
import { assertReturnPreview } from '@/lib/note-return-value';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'AP_DEBITS', action: 'view' }, async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
});

export const PUT = withPermission({ module: 'AP_DEBITS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
    const parsed = updatePurchaseReturnInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid purchase return payload' }, { status: 400 }));
    }
    const { lines, expectedValuation, ...header } = parsed.data;

    // Voiding a posted return must reverse its inventory journal entry and unwind
    // the stock — only the dedicated endpoint does that. A bare status flip here
    // would leave the GL + inventory wrong (the bug this guards against).
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted purchase return through POST /api/v1/purchase-returns/:id/void' },
        { status: 422 },
      ));
    }

    const pr = await prisma.$transaction(async (tx) => {
      const initial = await tx.purchaseReturn.findFirst({ where: { id, organizationId: orgId }, select: { billId: true } });
      if (!initial) throw new ApiError('Purchase return not found', 404);
      for (const billId of [...new Set([initial.billId, header.billId ?? initial.billId])].sort()) {
        await lockPurchaseReturns(tx, orgId, billId);
      }
      await tx.$queryRaw`SELECT "id" FROM "PurchaseReturn" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
      const prior = await tx.purchaseReturn.findFirst({
        where: { id, organizationId: orgId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!prior) throw new ApiError('Purchase return not found', 404);
      if (prior.billId !== initial.billId) throw new ApiError('Purchase return source bill changed. Reload the return and retry.', 409);

      const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1 && lines === undefined;
      if (prior.status !== 'DRAFT' && !isStatusOnlyUpdate) {
        throw new ApiError('Only DRAFT purchase returns can be modified', 422);
      }
      if (prior.status !== 'DRAFT' && (prior.status === 'VOID' || header.status === 'DRAFT')) {
        throw new ApiError('Finalized purchase returns cannot return to draft or be reopened after voiding', 422);
      }

      const returnItemIds = new Set((lines ?? []).map(line => line.itemId).filter((itemId): itemId is string => Boolean(itemId)));
      for (const itemId of returnItemIds) {
        await validateForeignKey(tx.item, { id: itemId, organizationId: orgId }, 'Item not found in organization');
      }
      const valuation = prior.status === 'DRAFT' ? await preparePurchaseReturnValuation(tx, orgId, {
        ...prior, ...header, lines: lines ?? prior.lines,
      }, id) : null;
      if (valuation) assertReturnPreview(valuation, expectedValuation);
      const { lines: valuedLines, ...amounts } = valuation ?? { lines: undefined };
      if (lines) {
        await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
      } else if (valuedLines) {
        for (const [index, line] of prior.lines.entries()) {
          await tx.purchaseReturnLine.update({ where: { id: line.id }, data: valuedLines[index] });
        }
      }

      const updated = await tx.purchaseReturn.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          ...amounts,
          ...(header.returnDate && { returnDate: new Date(header.returnDate) }),
          updatedAt: new Date(),
          ...(lines && valuedLines ? { lines: { create: valuedLines } } : {}),
        },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
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
          await postPurchaseReturnOnApproval(tx, id, dateOverride);
        }
      }

      return tx.purchaseReturn.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
    });

    logAudit({ orgId, actorId: userId, entityType: 'PurchaseReturn', entityId: id, action: 'UPDATE', payload: parsed.data });
    return withCors(NextResponse.json(pr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: error instanceof ApiError ? error.status : 500 }));
  }
});

export const DELETE = withPermission({ module: 'AP_DEBITS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.$transaction(async (tx) => {
      await lockReturnForDeletion(tx, 'purchase', orgId, id);
      const prior = await tx.purchaseReturn.findFirst({ where: { id, organizationId: orgId } });
      if (!prior) throw new ApiError('Purchase return not found', 404);
      if (prior.status !== 'DRAFT' || prior.postedAt || prior.journalEntryId) {
        throw new ApiError('Only draft purchase returns can be deleted; void finalized returns instead', 422);
      }
      await assertNoLinkedNotes(tx, 'purchase', orgId, id);
      await logAuditTx(tx, { orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseReturn', entityId: id,
        action: 'DELETE', payload: { number: prior.number, billId: prior.billId } });
      await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
      await tx.purchaseReturn.delete({ where: { id, organizationId: orgId } });
    });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: error instanceof ApiError ? error.status : 500 }));
  }
});
