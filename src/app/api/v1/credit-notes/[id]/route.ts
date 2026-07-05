import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { asMoney, toNumber } from '@/lib/money';
import { updateCreditNoteInputSchema } from '@/types/api';
import { postCreditNoteOnApply } from '@/lib/credit-note-posting';
import { routeForApproval } from '@/lib/approval/engine';

export const runtime = 'nodejs';

// Field allow-list for status-only PUT calls. If a body has only these fields,
// it's treated as a lifecycle transition (allowed on a posted note); any other
// fields make it an edit and require the note to still be DRAFT.
const STATUS_ONLY_FIELDS = new Set(['status']);

function isPosted(prior: { status: string; journalEntryId?: string | null }): boolean {
  return prior.status === 'APPLIED' || Boolean(prior.journalEntryId);
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const cn = await prisma.creditNote.findFirst({
      where: { id, organizationId: orgId },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        salesReturn: true,
        sourceInvoice: { select: { id: true, number: true } },
      },
    });
    if (!cn) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(cn));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

// PUT handles edits and the status lifecycle:
//   - DRAFT → APPLIED books a journal entry (DR Sales-Return / CR AR) and
//     stamps `journalEntryId` + `postedAt` on the note as the idempotency
//     token. The helper short-circuits if the token is already set.
//   - Any `* → DRAFT` once the note has left DRAFT is rejected (422). This
//     is the belt-and-suspenders complement to the DB-token check —
//     prevents the VOID → DRAFT → APPLIED path that would otherwise re-post.
//   - Edits to a posted note (any field beyond `status`) are rejected (422).
//     The recommended path is APPLIED → VOID, then create a replacement.
export const PUT = withPermission({ module: 'AR_CREDITS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }
  try {
    const body = await req.json();

    // Voiding a posted note must reverse its journal entry — that only happens
    // through the dedicated endpoint. A bare status flip here would leave the
    // posting entry live (the bug this guards against).
    if (String(body.status ?? '').toUpperCase() === 'VOID') {
      return withCors(
        NextResponse.json(
          { error: 'Void a posted credit note through POST /api/v1/credit-notes/:id/void' },
          { status: 422 },
        ),
      );
    }

    const parsed = updateCreditNoteInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid credit note payload' }, { status: 400 }));
    }
    const d = parsed.data;

    const cn = await prisma.$transaction(async (tx) => {
      const prior = await tx.creditNote.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, status: true, journalEntryId: true },
      });
      if (!prior) {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }

      const nextStatus = d.status;
      const isStatusOnly = Object.keys(d).every((k) => STATUS_ONLY_FIELDS.has(k));

      if (isPosted(prior) && !isStatusOnly) {
        throw Object.assign(
          new Error('Cannot edit a posted credit note — void it and create a replacement'),
          { status: 422 },
        );
      }

      if (nextStatus === 'DRAFT' && prior.status !== 'DRAFT') {
        throw Object.assign(
          new Error('Cannot revert credit note to DRAFT once it has left DRAFT'),
          { status: 422 },
        );
      }

      const updated = await tx.creditNote.update({
        where: { id, organizationId: orgId },
        data: {
          ...d,
          ...(d.amount !== undefined && { amount: asMoney(toNumber(d.amount)) }),
          ...(d.taxAmount !== undefined && { taxAmount: asMoney(toNumber(d.taxAmount)) }),
          ...(d.date !== undefined && { date: new Date(d.date) }),
          updatedAt: new Date(),
        },
      });

      // Auto-route the DRAFT → APPLIED finalize through the approval engine.
      // The update above may have already stamped status='APPLIED'; if approval
      // is required, hold the note at PENDING_APPROVAL and post NO GL.
      if (prior.status === 'DRAFT' && nextStatus === 'APPLIED') {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'CREDIT_NOTE',
          documentId: id,
        });
        if (routed) {
          return tx.creditNote.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        }
        await postCreditNoteOnApply(tx, id);
      }

      return updated;
    });

    logAudit({ orgId, actorId: userId, entityType: 'CreditNote', entityId: id, action: 'UPDATE', payload: d });
    return withCors(NextResponse.json(cn));
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status }));
  }
});

// DELETE only allowed on DRAFT (or a never-posted note). A posted note must
// be voided through PUT — deleting it would orphan its journal entry.
export const DELETE = withPermission({ module: 'AR_CREDITS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const prior = await prisma.creditNote.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true, journalEntryId: true },
    });
    if (!prior) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }
    if (isPosted(prior)) {
      return withCors(
        NextResponse.json(
          { error: 'Cannot delete a posted credit note — void it instead' },
          { status: 422 },
        ),
      );
    }
    await prisma.creditNote.delete({ where: { id, organizationId: orgId } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'CreditNote', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
