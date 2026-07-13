import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { modifierAttachmentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseModifierAttachmentPayload(orgId: string, body: unknown) {
  const parsed = modifierAttachmentInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(
      parsed.error.issues[0]?.message || 'Invalid modifier attachment payload',
      400,
    );
  }

  return parsed.data;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get('groupId');
  const itemId = searchParams.get('itemId');
  const itemCategoryId = searchParams.get('itemCategoryId');

  const where: any = { organizationId: orgId };
  if (groupId) where.groupId = groupId;
  if (itemId) where.itemId = itemId;
  if (itemCategoryId) where.itemCategoryId = itemCategoryId;

  const data = await prisma.modifierAttachment.findMany({
    where,
    include: {
      group: { select: { id: true, name: true } },
      item: { select: { id: true, name: true } },
      itemCategory: { select: { id: true, name: true } },
    },
  });

  return ok(data);
});

export const POST = withPermission({ module: 'POS_RETAIL', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const parsed = parseModifierAttachmentPayload(orgId, body);

  const group = await prisma.modifierGroup.findFirst({
    where: { id: parsed.groupId, organizationId: orgId },
    select: { id: true },
  });
  if (!group) return err('Modifier group not found', 404);

  if (parsed.itemId) {
    const item = await prisma.item.findFirst({
      where: { id: parsed.itemId, organizationId: orgId },
      select: { id: true },
    });
    if (!item) return err('Item not found', 404);
  }

  if (parsed.itemCategoryId) {
    const category = await prisma.itemCategory.findFirst({
      where: { id: parsed.itemCategoryId, organizationId: orgId },
      select: { id: true },
    });
    if (!category) return err('Item category not found', 404);
  }

  const created = await prisma.modifierAttachment.create({
    data: {
      organizationId: orgId,
      groupId: parsed.groupId,
      itemId: parsed.itemId ?? null,
      itemCategoryId: parsed.itemCategoryId ?? null,
    },
    include: {
      group: { select: { id: true, name: true } },
      item: { select: { id: true, name: true } },
      itemCategory: { select: { id: true, name: true } },
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'ModifierAttachment',
    entityId: created.id,
    action: 'CREATE',
    payload: body,
  });

  return ok(created, 201);
});
