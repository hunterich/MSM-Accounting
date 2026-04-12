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
  const payrollRun = await prisma.payrollRun.findFirst({
    where: { id, organizationId: orgId },
    include: {
      lines: {
        include: {
          employee: {
            select: { id: true, name: true, employeeNo: true, department: { select: { name: true } } },
          },
        },
        orderBy: { employee: { name: 'asc' } },
      },
    },
  });
  if (!payrollRun) return err('Not found', 404);
  return ok(payrollRun);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();

  const existing = await prisma.payrollRun.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return err('Not found', 404);
  if (existing.status === 'POSTED') return err('Cannot modify posted payroll run', 400);

  const updateData: any = {};
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.status === 'REVIEWED' && (existing.status === 'CALCULATED' || existing.status === 'DRAFT')) {
    updateData.status = 'REVIEWED';
  }

  const updated = await prisma.payrollRun.update({
    where: { id },
    data: updateData,
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PayrollRun', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.payrollRun.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Can only delete draft payroll runs', 400);

  await prisma.payrollRun.delete({ where: { id } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PayrollRun', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
