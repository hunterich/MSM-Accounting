import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, ok, err, logAudit, softDelete, validateForeignKey } from '@/lib/api-utils';
import { updateEmployeeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

function serializeEmployee(employee: any) {
  if (!employee) return employee;

  const compensationItems = Array.isArray(employee.compensationItems) ? employee.compensationItems : [];
  const allowances = compensationItems
    .filter((item) => item.type === 'ALLOWANCE')
    .map((item) => ({ id: item.id, name: item.name, amount: item.amount }));
  const deductions = compensationItems
    .filter((item) => item.type === 'DEDUCTION')
    .map((item) => ({ id: item.id, name: item.name, amount: item.amount }));

  return {
    ...employee,
    allowances,
    deductions,
  };
}

async function resolveDepartmentId(
  tx: any,
  orgId: string,
  departmentId?: string,
  departmentName?: string,
) {
  if (departmentId) {
    await validateForeignKey(tx.department, { id: departmentId, organizationId: orgId }, 'Department not found in organization');
    return departmentId;
  }
  if (departmentName === undefined) return undefined;
  if (!departmentName.trim()) return null;

  const existing = await tx.department.findFirst({
    where: { organizationId: orgId, name: departmentName.trim() },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await tx.department.create({
    data: { organizationId: orgId, name: departmentName.trim() },
    select: { id: true },
  });

  return created.id;
}

async function resolvePositionId(
  tx: any,
  orgId: string,
  positionId?: string,
  positionName?: string,
) {
  if (positionId) {
    await validateForeignKey(tx.position, { id: positionId, organizationId: orgId }, 'Position not found in organization');
    return positionId;
  }
  if (positionName === undefined) return undefined;
  if (!positionName.trim()) return null;

  const existing = await tx.position.findFirst({
    where: { organizationId: orgId, name: positionName.trim() },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await tx.position.create({
    data: { organizationId: orgId, name: positionName.trim() },
    select: { id: true },
  });

  return created.id;
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
  return ok(serializeEmployee(employee));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const normalizedBody = {
    ...body,
    status: typeof body.status === 'string' ? String(body.status).trim().toUpperCase().replace(/\s+/g, '_') : body.status,
    type: typeof body.type === 'string' ? String(body.type).trim().toUpperCase().replace(/-|\s+/g, '_') : body.type,
  };
  const parsed = updateEmployeeInputSchema.safeParse(normalizedBody);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid employee payload', 400);

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const existing = await tx.employee.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (!existing) return null;

      const departmentId = await resolveDepartmentId(tx, orgId, parsed.data.departmentId, parsed.data.department);
      const positionId = await resolvePositionId(tx, orgId, parsed.data.positionId, parsed.data.position);

      await tx.employee.update({
        where: { id, organizationId: orgId },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.ktp !== undefined && { ktp: parsed.data.ktp || null }),
          ...(parsed.data.dob !== undefined && { dob: parsed.data.dob ? new Date(parsed.data.dob) : null }),
          ...(parsed.data.phone !== undefined && { phone: parsed.data.phone || null }),
          ...(parsed.data.email !== undefined && { email: parsed.data.email || null }),
          ...(parsed.data.address !== undefined && { address: parsed.data.address || null }),
          ...(parsed.data.joinDate !== undefined && { joinDate: new Date(parsed.data.joinDate) }),
          ...(departmentId !== undefined && { departmentId }),
          ...(positionId !== undefined && { positionId }),
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          ...(parsed.data.type !== undefined && { type: parsed.data.type }),
          ...(parsed.data.bankName !== undefined && { bankName: parsed.data.bankName || null }),
          ...(parsed.data.accountNumber !== undefined && { accountNumber: parsed.data.accountNumber || null }),
          ...(parsed.data.accountHolder !== undefined && { accountHolder: parsed.data.accountHolder || null }),
          ...(parsed.data.npwp !== undefined && { npwp: parsed.data.npwp || null }),
          ...(parsed.data.bpjsKesehatan !== undefined && { bpjsKesehatan: parsed.data.bpjsKesehatan || null }),
          ...(parsed.data.bpjsKetenagakerjaan !== undefined && { bpjsKetenagakerjaan: parsed.data.bpjsKetenagakerjaan || null }),
          ...(parsed.data.basicSalary !== undefined && { basicSalary: parsed.data.basicSalary }),
          updatedAt: new Date(),
        },
      });

      if (parsed.data.allowances !== undefined || parsed.data.deductions !== undefined) {
        await tx.employeeCompensationItem.deleteMany({ where: { employeeId: id } });
        const allowances = parsed.data.allowances ?? [];
        const deductions = parsed.data.deductions ?? [];
        const compensationItems = [
          ...allowances.map((item) => ({ employeeId: id, type: 'ALLOWANCE' as const, name: item.name, amount: item.amount })),
          ...deductions.map((item) => ({ employeeId: id, type: 'DEDUCTION' as const, name: item.name, amount: item.amount })),
        ];
        if (compensationItems.length > 0) {
          await tx.employeeCompensationItem.createMany({ data: compensationItems });
        }
      }

      return tx.employee.findFirst({
        where: { id, organizationId: orgId },
        include: {
          department: true,
          position: true,
          compensationItems: true,
        },
      });
    });

    if (!employee) return err('Not found', 404);
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Employee', entityId: id, action: 'UPDATE', payload: body });
    return ok(serializeEmployee(employee));
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to update employee';
    return err(message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const deleted = await softDelete(
    prisma.employee,
    { id, organizationId: orgId, status: { not: 'INACTIVE' } },
    { status: 'INACTIVE', updatedAt: new Date() },
  );
  if (!deleted) return err('Not found', 404);
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Employee', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}
