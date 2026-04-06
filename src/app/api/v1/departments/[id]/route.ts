import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, withHandler } from '@/lib/api-utils';
import { departmentInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function parseDepartmentPayload(orgId: string, body: unknown) {
  const parsed = departmentInputSchema.safeParse({
    ...(body as object),
    organizationId: orgId,
  });

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid department payload', 400);
  }

  return parsed.data;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const department = await prisma.department.findFirst({
    where: { id, organizationId: orgId },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });

  if (!department) return err('Not found', 404);
  return ok(department);
});

export const PUT = withHandler(async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const payload = parseDepartmentPayload(orgId, body);

  const department = await prisma.department.update({
    where: { id, organizationId: orgId },
    data: payload,
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Department',
    entityId: id,
    action: 'UPDATE',
    payload: body,
  });

  return ok(department);
});

export const DELETE = withHandler(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const department = await prisma.department.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, _count: { select: { employees: true } } },
  });

  if (!department) return err('Not found', 404);
  if (department._count.employees > 0) {
    throw new ApiError('Cannot delete a department assigned to employees', 400);
  }

  await prisma.department.delete({
    where: { id, organizationId: orgId },
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Department',
    entityId: id,
    action: 'DELETE',
    payload: null,
  });

  return ok({ deleted: true });
});
