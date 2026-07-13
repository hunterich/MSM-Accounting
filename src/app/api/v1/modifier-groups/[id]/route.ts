import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { modifierGroupInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseModifierGroupPayload(orgId: string, body: unknown) {
  const parsed = modifierGroupInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid modifier group payload', 400);
  }

  return parsed.data;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const group = await prisma.modifierGroup.findFirst({
    where: { id, organizationId: orgId },
    include: {
      options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      attachments: true,
    },
  });

  if (!group) return err('Not found', 404);
  return ok(group);
});

export const PUT = withPermission({ module: 'POS_RETAIL', action: 'edit' }, async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const existing = await prisma.modifierGroup.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return err('Not found', 404);

  const body = await req.json();
  const parsed = parseModifierGroupPayload(orgId, body);

  const [, updated] = await prisma.$transaction([
    prisma.modifierOption.deleteMany({ where: { groupId: id } }),
    prisma.modifierGroup.update({
      where: { id },
      data: {
        name: parsed.name,
        selectionType: parsed.selectionType,
        isRequired: parsed.isRequired,
        sortOrder: parsed.sortOrder,
        isActive: parsed.isActive,
        options: {
          create: parsed.options.map((o) => ({
            name: o.name,
            priceDelta: o.priceDelta,
            itemId: o.itemId ?? null,
            sortOrder: o.sortOrder,
            isActive: o.isActive,
          })),
        },
      },
      include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    }),
  ]);

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'ModifierGroup',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(updated);
});

export const DELETE = withPermission({ module: 'POS_RETAIL', action: 'delete' }, async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const existing = await prisma.modifierGroup.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return err('Not found', 404);

  await prisma.modifierGroup.delete({ where: { id } });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'ModifierGroup',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ id });
});
