import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { asMoney, toNumber } from '@/lib/money';
import { postDebitNoteOnApply } from '@/lib/debit-note-posting';

export const runtime = 'nodejs';

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

// PUT handles edits and the status lifecycle. The DRAFT → APPLIED transition
// is the only one that books a journal entry; APPLIED → DRAFT is forbidden
// so the same note can never re-enter DRAFT and trigger a duplicate post.
// (DebitNote has no journalEntryId column, so the transition guard is the
// idempotency mechanism — see lib/debit-note-posting.ts header.)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();

    const dn = await prisma.$transaction(async (tx) => {
      const prior = await tx.debitNote.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, status: true },
      });
      if (!prior) {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }

      const nextStatus = body.status as 'DRAFT' | 'APPLIED' | 'VOID' | undefined;
      if (nextStatus && prior.status === 'APPLIED' && nextStatus === 'DRAFT') {
        throw Object.assign(
          new Error('Cannot revert APPLIED debit note to DRAFT'),
          { status: 422 },
        );
      }

      const updated = await tx.debitNote.update({
        where: { id, organizationId: orgId },
        data: {
          ...body,
          ...(body.amount !== undefined && { amount: asMoney(toNumber(body.amount)) }),
          ...(body.date && { date: new Date(body.date) }),
          updatedAt: new Date(),
        },
      });

      if (prior.status === 'DRAFT' && nextStatus === 'APPLIED') {
        await postDebitNoteOnApply(tx, id);
      }

      return updated;
    });

    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(dn));
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.debitNote.delete({ where: { id, organizationId: orgId } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
