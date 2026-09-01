import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { asMoney, toNumber } from '@/lib/money';
import { updateDebitNoteInputSchema } from '@/types/api';
import { postDebitNoteOnApply } from '@/lib/debit-note-posting';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';

export const runtime = 'nodejs';

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
    const dn = await prisma.debitNote.findFirst({
      where: { id, organizationId: orgId },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        purchaseReturn: true,
        sourceBill: { select: { id: true, number: true } },
      },
    });
    if (!dn) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(dn));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

// PUT — see credit-notes/[id]/route.ts for the lifecycle contract. Same
// guards: DRAFT → APPLIED books a JE and stamps the idempotency token,
// `* → DRAFT` is forbidden once the note has left DRAFT, and edits to a
// posted note (any field beyond `status`) return 422.
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

    // Voiding a posted note must reverse its journal entry — that only happens
    // through the dedicated endpoint. A bare status flip here would leave the
    // posting entry live (the bug this guards against).
    if (String(body.status ?? '').toUpperCase() === 'VOID') {
      return withCors(
        NextResponse.json(
          { error: 'Void a posted debit note through POST /api/v1/debit-notes/:id/void' },
          { status: 422 },
        ),
      );
    }

    const parsed = updateDebitNoteInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid debit note payload' }, { status: 400 }));
    }
    const d = parsed.data;

    const dn = await prisma.$transaction(async (tx) => {
      const prior = await tx.debitNote.findFirst({
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
          new Error('Cannot edit a posted debit note — void it and create a replacement'),
          { status: 422 },
        );
      }

      if (nextStatus === 'DRAFT' && prior.status !== 'DRAFT') {
        throw Object.assign(
          new Error('Cannot revert debit note to DRAFT once it has left DRAFT'),
          { status: 422 },
        );
      }

      const updated = await tx.debitNote.update({
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
          documentType: 'DEBIT_NOTE',
          documentId: id,
        });
        if (routed) {
          return tx.debitNote.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        }
        await postDebitNoteOnApply(tx, id, dateOverride);
      }

      return updated;
    });

    logAudit({ orgId, actorId: userId, entityType: 'DebitNote', entityId: id, action: 'UPDATE', payload: d });
    return withCors(NextResponse.json(dn));
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status }));
  }
});

// DELETE only allowed on DRAFT (or a never-posted note). A posted note must
// be voided through PUT — deleting it would orphan its journal entry.
export const DELETE = withPermission({ module: 'AP_DEBITS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const prior = await prisma.debitNote.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true, journalEntryId: true },
    });
    if (!prior) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }
    if (isPosted(prior)) {
      return withCors(
        NextResponse.json(
          { error: 'Cannot delete a posted debit note — void it instead' },
          { status: 422 },
        ),
      );
    }
    await prisma.debitNote.delete({ where: { id, organizationId: orgId } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});
