import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const template = await (prisma as any).emailTemplate.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!template) throw new ApiError('Template not found', 404);
  return ok(template);
});

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;
  const body = await req.json();

  const existing = await (prisma as any).emailTemplate.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new ApiError('Template not found', 404);

  const updated = await (prisma as any).emailTemplate.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.bodyHtml !== undefined && { bodyHtml: body.bodyHtml }),
      ...(body.bodyText !== undefined && { bodyText: body.bodyText }),
      ...(body.variables !== undefined && { variables: JSON.stringify(body.variables) }),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'EmailTemplate',
    entityId: id,
    action: 'UPDATE',
    payload: { name: updated.name },
  });

  return ok(updated);
});

export const DELETE = withPermission({ module: 'SETTINGS', action: 'delete' }, async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const existing = await (prisma as any).emailTemplate.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new ApiError('Template not found', 404);

  await (prisma as any).emailTemplate.delete({ where: { id } });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'EmailTemplate',
    entityId: id,
    action: 'DELETE',
    payload: { name: existing.name },
  });

  return ok({ deleted: true });
});
