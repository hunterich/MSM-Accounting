// POST /api/v1/debit-notes/[id]/void
// Reverses an applied debit note's journal entry and marks it VOID.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, requireOrg, withHandler, logAudit } from '@/lib/api-utils';
import { voidDebitNote } from '@/lib/note-void';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = requireOrg(req);
  const date = new Date();

  const note = await prisma.$transaction(async (tx) => {
    await voidDebitNote(tx, orgId, id, { date });
    return tx.debitNote.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: { select: { id: true, name: true, code: true } } },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'DebitNote', entityId: id, action: 'VOID', payload: null });
  return ok(note);
});
