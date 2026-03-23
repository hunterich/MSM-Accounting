import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const employee = await prisma.employee.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: true,
      position: true,
      compensationItems: true,
    },
  });
  if (!employee) return err('Not found', 404);
  return ok(employee);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const employee = await prisma.employee.update({
    where: { id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Employee', entityId: id, action: 'UPDATE', payload: body });
  return ok(employee);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  await prisma.employee.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Employee', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
