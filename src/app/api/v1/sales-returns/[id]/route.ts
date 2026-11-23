import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit, logAuditTx } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { routeForApproval } from '@/lib/approval/engine';
import { updateSalesReturnInputSchema } from '@/types/api';
import { prepareSalesReturnValuation, lockSalesReturns } from '@/lib/sales-return-lines';
import { ApiError } from '@/lib/errors';
import { lockReturnForDeletion, assertNoLinkedNotes } from '@/lib/return-deletion-guard';
import { roundMoneyDecimal } from '@/lib/money-decimal';
import { assertReturnPreview } from '@/lib/note-return-value';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'AR_CREDITS', action: 'view' }, async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const sr = await prisma.salesReturn.findFirst({
      where: { id, organizationId: orgId },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        invoice: { select: { id: true, number: true, lines: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    });
    if (!sr) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(sr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const PUT = withPermission({ module: 'AR_CREDITS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
    const parsed = updateSalesReturnInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid sales return payload' }, { status: 400 }));
    }
    const { lines, expectedValuation, ...header } = parsed.data;

    // Voiding a posted return must reverse its inventory journal entry and unwind
    // the stock — only the dedicated endpoint does that. A bare status flip here
    // would leave the GL + inventory wrong (the bug this guards against).
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted sales return through POST /api/v1/sales-returns/:id/void' },
        { status: 422 },
      ));
    }

    const sr = await prisma.$transaction(async (tx) => {
      const initial = await tx.salesReturn.findFirst({ where: { id, organizationId: orgId } });
      if (!initial) throw new ApiError('Sales return not found', 404);
      for (const invoiceId of [...new Set([initial.invoiceId, header.invoiceId ?? initial.invoiceId])].sort()) {
        await lockSalesReturns(tx, orgId, invoiceId);
      }
      const prior = await tx.salesReturn.findFirst({
        where: { id, organizationId: orgId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!prior) {
        throw new Error('Sales return not found');
      }
      if (prior.invoiceId !== initial.invoiceId) throw new ApiError('Sales return source invoice changed. Reload the return and retry.', 409);

      const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1 && lines === undefined;
      if (prior.status !== 'DRAFT' && !isStatusOnlyUpdate) {
        throw new Error('Only DRAFT sales returns can be modified');
      }
      if (prior.status !== 'DRAFT' && header.status !== prior.status) {
        throw new ApiError('Finalized sales returns cannot change status here; use the void action', 422);
      }
      const valuation = prior.status === 'DRAFT' ? await prepareSalesReturnValuation(
        tx, orgId, header.invoiceId ?? prior.invoiceId, header.customerId ?? prior.customerId,
        lines ?? prior.lines, id,
      ) : null;
      if (valuation) assertReturnPreview(valuation.amounts, expectedValuation);

      if (lines) {
        await tx.salesReturnLine.deleteMany({ where: { salesReturnId: id } });
      } else if (valuation) {
        for (let i = 0; i < prior.lines.length; i++) {
          await tx.salesReturnLine.update({ where: { id: prior.lines[i].id }, data: {
            ...valuation.amounts.lines[i], sourceInvoiceLineId: valuation.prepared[i].sourceInvoiceLineId,
          } });
        }
      }

      const updated = await tx.salesReturn.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          ...(header.returnDate && { returnDate: new Date(header.returnDate) }),
          ...(valuation && { subtotal: valuation.amounts.subtotal, taxAmount: valuation.amounts.taxAmount, totalAmount: valuation.amounts.totalAmount,
            applyTax: valuation.invoice.taxEnabled, taxIncluded: valuation.invoice.taxInclusive, taxRate: valuation.invoice.taxRate }),
          updatedAt: new Date(),
          ...(lines && valuation ? {
            lines: {
              create: lines.map((l, idx) => ({
                lineNo:    idx + 1,
                sourceInvoiceLineId: valuation.prepared[idx].sourceInvoiceLineId,
                goodsReceived: valuation.prepared[idx].goodsReceived,
                itemId:    valuation.prepared[idx].itemId,
                itemName:  valuation.prepared[idx].itemName,
                qtySold:   valuation.prepared[idx].qtySold,
                qtyReturn: valuation.prepared[idx].qtyReturn,
                unit:      l.unit || 'PCS',
                price:     roundMoneyDecimal(l.price ?? 0),
                ...valuation.amounts.lines[idx],
              })),
            },
          } : {}),
        },
        include: { lines: true },
      });

      // Post inventory leg on DRAFT → APPROVED transition (idempotent via journalEntryId),
      // unless the approval engine routes the finalize for approval first. The update
      // above may have already stamped status='APPROVED'; if approval is required,
      // hold the return at PENDING_APPROVAL and post NO GL.
      if (prior.status === 'DRAFT' && ['APPROVED', 'PENDING_CREDIT_NOTE'].includes(updated.status) && !prior.postedAt) {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'SALES_RETURN',
          documentId: id,
        });
        if (routed) {
          await tx.salesReturn.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          await postSalesReturnOnApproval(tx, id, dateOverride);
        }
      }

      return tx.salesReturn.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
    });

    logAudit({ orgId, actorId: userId, entityType: 'SalesReturn', entityId: id, action: 'UPDATE', payload: parsed.data });
    return withCors(NextResponse.json(sr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: error instanceof ApiError ? error.status : 500 }));
  }
});

export const DELETE = withPermission({ module: 'AR_CREDITS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.$transaction(async (tx) => {
      const initial = await tx.salesReturn.findFirst({ where: { id, organizationId: orgId } });
      if (!initial) throw new ApiError('Sales return not found', 404);
      await lockSalesReturns(tx, orgId, initial.invoiceId);
      await lockReturnForDeletion(tx, 'sales', orgId, id);
      const prior = await tx.salesReturn.findFirst({ where: { id, organizationId: orgId } });
      if (prior && prior.invoiceId !== initial.invoiceId) {
        throw new ApiError('Sales return changed its source invoice; retry deletion', 409);
      }
      if (!prior || prior.status !== 'DRAFT' || prior.postedAt || prior.journalEntryId) {
        throw new ApiError('Only draft sales returns can be deleted; void finalized returns instead', 422);
      }
      await assertNoLinkedNotes(tx, 'sales', orgId, id);
      await logAuditTx(tx, { orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: id,
        action: 'DELETE', payload: { number: prior.number, invoiceId: prior.invoiceId } });
      await tx.salesReturnLine.deleteMany({ where: { salesReturnId: id } });
      await tx.salesReturn.delete({ where: { id, organizationId: orgId } });
    });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: error instanceof ApiError ? error.status : 500 }));
  }
});
