import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, listResponse, nextNumber, logAudit, parsePaginationParams, validateForeignKey } from '@/lib/api-utils';
import { employeeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

function serializeEmployee(employee: any) {
  if (!employee) return employee;

  const compensationItems: Array<{ id?: string; type?: string; name?: string; amount?: number }> =
    Array.isArray(employee.compensationItems) ? employee.compensationItems : [];
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
  if (!departmentName) return null;

  const normalized = departmentName.trim();
  if (!normalized) return null;

  const existing = await tx.department.findFirst({
    where: { organizationId: orgId, name: normalized },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await tx.department.create({
    data: { organizationId: orgId, name: normalized },
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
  if (!positionName) return null;

  const normalized = positionName.trim();
  if (!normalized) return null;

  const existing = await tx.position.findFirst({
    where: { organizationId: orgId, name: normalized },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await tx.position.create({
    data: { organizationId: orgId, name: normalized },
    select: { id: true },
  });

  return created.id;
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');
  const status = searchParams.get('status');
  const where: any = { organizationId: orgId, status: status || 'ACTIVE' };
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { employeeNo: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);
  return listResponse(data.map(serializeEmployee), total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const normalizedBody = {
    ...body,
    status: typeof body.status === 'string' ? String(body.status).trim().toUpperCase().replace(/\s+/g, '_') : body.status,
    type: typeof body.type === 'string' ? String(body.type).trim().toUpperCase().replace(/-|\s+/g, '_') : body.type,
  };
  const parsed = employeeInputSchema.safeParse({
    ...normalizedBody,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid employee payload', 400);
  }

  const employee = await prisma.$transaction(async (tx) => {
    const departmentId = await resolveDepartmentId(tx, orgId, parsed.data.departmentId, parsed.data.department);
    const positionId = await resolvePositionId(tx, orgId, parsed.data.positionId, parsed.data.position);
    const employeeNo = await nextNumber(tx, 'Employee', 'employeeNo', 'EMP');

    return tx.employee.create({
      data: {
        organizationId: orgId,
        employeeNo,
        name: parsed.data.name,
        ktp: parsed.data.ktp || null,
        dob: parsed.data.dob ? new Date(parsed.data.dob) : null,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        address: parsed.data.address || null,
        joinDate: new Date(parsed.data.joinDate),
        departmentId,
        positionId,
        status: parsed.data.status,
        type: parsed.data.type,
        bankName: parsed.data.bankName || null,
        accountNumber: parsed.data.accountNumber || null,
        accountHolder: parsed.data.accountHolder || null,
        npwp: parsed.data.npwp || null,
        bpjsKesehatan: parsed.data.bpjsKesehatan || null,
        bpjsKetenagakerjaan: parsed.data.bpjsKetenagakerjaan || null,
        basicSalary: parsed.data.basicSalary,
        compensationItems: {
          create: [
            ...parsed.data.allowances.map((item) => ({
              type: 'ALLOWANCE' as const,
              name: item.name,
              amount: item.amount,
            })),
            ...parsed.data.deductions.map((item) => ({
              type: 'DEDUCTION' as const,
              name: item.name,
              amount: item.amount,
            })),
          ],
        },
      },
      include: {
        department: true,
        position: true,
        compensationItems: true,
      },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Employee', entityId: employee.id, action: 'CREATE', payload: { name: employee.name, employeeNo: employee.employeeNo } });
  return ok(serializeEmployee(employee), 201);
});
