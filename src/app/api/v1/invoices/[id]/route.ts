import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { reverseInvoicePosting } from '@/lib/repost';
import { assertPeriodOpen } from '@/lib/period-guard';
import { routeForApproval } from '@/lib/approval/engine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    const userId = _req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const invoice = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        lines: true,
        charges: true,
      },
    });
    if (!invoice) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(invoice));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const PUT = withPermission({ module: 'AR_INVOICES', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const body = await req.json();
    const { lines, charges, ...header } = body;
    delete header.organizationId;
    delete header.createdById;

    // Voiding a posted invoice must reverse its journal entries and restore the
    // sold stock — that only happens through the dedicated endpoint. A bare
    // status flip here would leave the GL + inventory wrong (the bug this guards).
    // Checked before any DB work so a rejected void is a cheap 422.
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted invoice through POST /api/v1/invoices/:id/void' },
        { status: 422 },
      ));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1;

    // Captured inside the transaction for the audit trail of an edit-after-post.
    let postedEditBefore: unknown = null;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        select: {
          id: true, status: true, number: true, issueDate: true, organizationId: true,
          lines: { select: { itemId: true } },
          _count: { select: { paymentAllocations: true, salesReturns: true, creditNotes: true } },
        },
      });

      if (!existing) {
        throw new AccessError('Invoice not found', 404);
      }

      // DRAFT → edit freely. SENT/OVERDUE field edit → edit-after-post: reverse the
      // posting, apply the edit, re-post — bounded by the open period. A status-only
      // update (e.g. marking paid) is NOT an edit and skips this. Everything else
      // (PAID/VOID/PENDING_APPROVAL) → must be voided to change.
      const isDraft = existing.status === 'DRAFT';
      const isPostedEdit =
        !isDraft && !isStatusOnlyUpdate && (existing.status === 'SENT' || existing.status === 'OVERDUE');
      if (!isDraft && !isPostedEdit && !isStatusOnlyUpdate) {
        throw new AccessError(`Cannot edit a ${existing.status} invoice — void it to change.`, 403);
      }

      // A DRAFT → SENT finalize ("send"). Gated below by an atomic status claim so
      // two concurrent sends can't both post the GL (double AR + revenue).
      const isDraftSend = isDraft && header.status === 'SENT';

      if (isPostedEdit) {
        // v1 keeps the reverse+re-post pure-GL: inventory invoices involve cost-layer
        // re-consumption that must be voided + re-sent instead.
        if (existing.lines.some((l) => l.itemId) || (lines ?? []).some((l: any) => l.itemId)) {
          throw new AccessError('This invoice has inventory items — void it to change (editing posted stock movements is not supported yet).', 422);
        }
        if (existing._count.paymentAllocations > 0) {
          throw new AccessError('Cannot edit an invoice with receipts applied — unallocate them first.', 422);
        }
        if (existing._count.salesReturns > 0 || existing._count.creditNotes > 0) {
          throw new AccessError('Cannot edit an invoice with returns or credit notes against it — reverse those first.', 422);
        }
        const newDate = header.issueDate ? new Date(header.issueDate) : new Date(existing.issueDate);
        await assertPeriodOpen(tx, existing.organizationId, new Date(existing.issueDate)); // posted period
        await assertPeriodOpen(tx, existing.organizationId, newDate);                       // re-post period
        postedEditBefore = await tx.salesInvoice.findFirst({ where: { id }, include: { lines: true, charges: true } });
        await reverseInvoicePosting(tx, existing.organizationId, { id: existing.id, number: existing.number }, { date: newDate });
      }

      // Atomically claim the DRAFT → SENT transition before any GL side effect:
      // only the request whose guarded updateMany flips the row (count === 1) may
      // post. A concurrent send blocks on the row lock, then sees status ≠ DRAFT →
      // count 0 → skips posting (the invoice is already SENT/PENDING_APPROVAL, so a
      // double-click is a harmless no-op). Mirrors the claim in lib/invoice-void.ts.
      let sendClaimWon = false;
      if (isDraftSend) {
        const claim = await tx.salesInvoice.updateMany({
          where: { id, organizationId: orgId, status: 'DRAFT' },
          data: { status: 'SENT' },
        });
        sendClaimWon = claim.count === 1;
      }

      await tx.salesInvoice.update({
        where: { id },
        data: {
          ...header,
          // The claim above is the sole authority for the DRAFT → SENT status flip —
          // don't let the blind header spread re-write it (that would revert the
          // claimed SENT, or clobber a concurrent PENDING_APPROVAL hold).
          ...(isDraftSend && { status: undefined }),
          // An edit never un-posts an invoice — keep it SENT/OVERDUE.
          ...(isPostedEdit && { status: existing.status }),
          updatedAt: new Date(),
        },
      });

      if (lines) {
        await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.salesInvoiceLine.createMany({
          data: lines.map((l: any, idx: number) => ({
            ...l,
            invoiceId: id,
            lineNo: l.lineNo ?? idx + 1,
          })),
        });
      }

      if (charges) {
        await tx.salesInvoiceCharge.deleteMany({ where: { invoiceId: id } });
        if (charges.length > 0) {
          await tx.salesInvoiceCharge.createMany({
            data: charges.map((c: any, idx: number) => ({
              invoiceId: id,
              lineNo: c.lineNo ?? idx + 1,
              label: c.label,
              accountId: c.accountId || null,
              amount: c.amount ?? 0,
              taxRate: c.taxRate ?? 0,
            })),
          });
        }
      }

      // Edit-after-post: re-post AR (+ charges) from the freshly-edited invoice
      // (its prior entries were reversed above). v1 edit-after-post is restricted
      // to non-inventory invoices, so no COGS re-consumption happens here.
      if (isPostedEdit) {
        await postInvoiceSend(tx, existing.organizationId, existing.id);
      }

      // Post AR + COGS journals when the invoice transitions DRAFT → SENT,
      // unless the approval engine routes the finalize for approval first. Only
      // the request that won the atomic claim above reaches here — the loser
      // (sendClaimWon === false) already left the row SENT/PENDING_APPROVAL and
      // must NOT post a second time.
      // The AR-side post (DR AR / CR Sales / CR Tax) runs for every invoice;
      // the COGS post only runs when the org has a costing method and the
      // invoice has inventory lines.
      if (isDraftSend && sendClaimWon) {
        const routed = await routeForApproval(tx, {
          orgId: existing.organizationId,
          userId,
          documentType: 'INVOICE',
          documentId: existing.id,
        });
        if (routed) {
          // HELD for approval: the claim above stamped status='SENT'; override it
          // back to PENDING_APPROVAL and post NO GL.
          await tx.salesInvoice.update({
            where: { id: existing.id },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          // Not required / already approved: keep SENT and post the GL.
          await postInvoiceSend(tx, existing.organizationId, existing.id);
        }
      }

      return tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        include: {
          customer: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
          lines: true,
          charges: true,
        },
      });
    });
    // For an edit-after-post, log before→after so the journal re-post is
    // attributable (who changed what); a plain draft edit logs the submitted body.
    logAudit({
      orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'UPDATE',
      payload: postedEditBefore ? { reposted: true, before: postedEditBefore, after: body } : body,
    });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof AccessError || error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AR_INVOICES', action: 'delete' }, async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    const userId = _req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const existing = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      select: { id: true, status: true },
    });

    if (!existing) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }

    if (existing.status !== 'DRAFT') {
      return withCors(NextResponse.json({ error: 'Only DRAFT invoices can be deleted' }, { status: 403 }));
    }

    await prisma.salesInvoice.update({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } });
    logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
