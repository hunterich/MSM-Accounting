import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateLeaveTypeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const record = await prisma.leaveType.findFirst({ where: { id, organizationId: orgId } });
  if (!record) return err('Not found', 404);
  return ok(record);
}

export const PUT = withPermission({ module: 'HR_ATTENDANCE', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateLeaveTypeInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);

  const existing = await prisma.leaveType.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);

  const updated = await prisma.leaveType.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.category !== undefined && { category: parsed.data.category }),
      ...(parsed.data.entitlementDays !== undefined && { entitlementDays: parsed.data.entitlementDays }),
      ...(parsed.data.carryOver !== undefined && { carryOver: parsed.data.carryOver }),
      ...(parsed.data.maxCarryDays !== undefined && { maxCarryDays: parsed.data.maxCarryDays }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveType', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
});

export const DELETE = withPermission({ module: 'HR_ATTENDANCE', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.leaveType.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);

  await prisma.leaveType.delete({ where: { id } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveType', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
});
