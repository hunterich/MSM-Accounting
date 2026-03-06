// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await prisma.employee.findUnique({
    where: { id: id },
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
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const employee = await prisma.employee.update({
    where: { id: id, organizationId: orgId },
    data: { ...body, updatedAt: new Date() },
  });
  return ok(employee);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = _req.headers.get('x-org-id');
  await prisma.employee.delete({ where: { id: id, organizationId: orgId } });
  return ok({ deleted: true });
}
