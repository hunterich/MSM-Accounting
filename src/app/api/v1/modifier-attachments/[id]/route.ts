import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, logAudit, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const DELETE = withPermission({ module: 'POS_RETAIL', action: 'delete' }, async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const existing = await prisma.modifierAttachment.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return err('Not found', 404);

  await prisma.modifierAttachment.delete({ where: { id } });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'ModifierAttachment',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ id });
});
