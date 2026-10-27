import { validateEmployeePayrollFields } from '@/lib/employee-payroll-fields';
import { lockPayroll } from '@/lib/payroll-posting';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  requireOrg,
  ok,
  err,
  listResponse,
  nextNumber,
  logAudit,
  parsePaginationParams,
  validateForeignKey,
} from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { employeeInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

function serializeEmployee(employee: any) {
  if (!employee) return employee;

  const compensationItems: Array<{
    id?: string;
    type?: string;
    name?: string;
    amount?: number;
    postingAccountId?: string | null;
    isFixed?: boolean | null;
  }> = Array.isArray(employee.compensationItems)
    ? employee.compensationItems
    : [];
  const allowances = compensationItems
    .filter((item) => item.type === 'ALLOWANCE')
    .map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      postingAccountId: item.postingAccountId || null,
      isFixed: item.isFixed ?? null,
    }));
  const deductions = compensationItems
    .filter((item) => item.type === 'DEDUCTION')
    .map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      postingAccountId: item.postingAccountId || null,
      isFixed: item.isFixed ?? null,
    }));

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
    await validateForeignKey(
      tx.department,
      { id: departmentId, organizationId: orgId },
      'Department not found in organization',
    );
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
    await validateForeignKey(
      tx.position,
      { id: positionId, organizationId: orgId },
      'Position not found in organization',
    );
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

export const GET = withPermission(
  { module: 'HR_EMPLOYEES', action: 'view' },
  async function GET(req: NextRequest) {
    const orgId = requireOrg(req);
    const { searchParams, page, limit } = parsePaginationParams(req, {
      limit: 20,
      maxLimit: 100,
    });
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const where: any = { organizationId: orgId };
    const employedOn = searchParams.get('employedOn');
    if (employedOn) {
      const date = new Date(employedOn);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(employedOn) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== employedOn
      )
        return err('Invalid employment eligibility date', 400);
      where.AND = [
        { joinDate: { lte: date } },
        {
          OR: [
            { employmentEndDate: { gte: date } },
            { employmentEndDate: null, status: 'ACTIVE' },
          ],
        },
      ];
    } else if (status !== 'ALL') {
      const today = new Date(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()) + 'T00:00:00Z',
      );
      where.AND =
        (status || 'ACTIVE') === 'INACTIVE'
          ? [
              {
                OR: [
                  { status: 'INACTIVE' },
                  { employmentEndDate: { lt: today } },
                ],
              },
            ]
          : [
              { status: status || 'ACTIVE' },
              {
                OR: [
                  { employmentEndDate: null },
                  { employmentEndDate: { gte: today } },
                ],
              },
            ];
    }
    const department = searchParams.get('department');
    if (department) where.department = { name: department };
    if (search)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { employeeNo: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    const [data, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: {
          department: { select: { id: true, name: true } },
          position: { select: { id: true, name: true } },
        },
      }),
      prisma.employee.count({ where }),
    ]);
    return listResponse(data.map(serializeEmployee), total, page, limit);
  },
);

export const POST = withPermission(
  { module: 'HR_EMPLOYEES', action: 'create' },
  async function POST(req: NextRequest) {
    const orgId = requireOrg(req);
    const body = await req.json();
    const normalizedBody = {
      ...body,
      status:
        typeof body.status === 'string'
          ? String(body.status).trim().toUpperCase().replace(/\s+/g, '_')
          : body.status,
      type:
        typeof body.type === 'string'
          ? String(body.type).trim().toUpperCase().replace(/-|\s+/g, '_')
          : body.type,
    };
    const parsed = employeeInputSchema.safeParse({
      ...normalizedBody,
      organizationId: orgId,
    });
    if (!parsed.success) {
      return err(
        parsed.error.issues[0]?.message || 'Invalid employee payload',
        400,
      );
    }

    const employee = await prisma.$transaction(async (tx) => {
      const departmentId = await resolveDepartmentId(
        tx,
        orgId,
        parsed.data.departmentId,
        parsed.data.department,
      );
      const positionId = await resolvePositionId(
        tx,
        orgId,
        parsed.data.positionId,
        parsed.data.position,
      );
      const employeeNo = await nextNumber(tx, 'Employee', 'employeeNo', 'EMP');

      await lockPayroll(tx, orgId);
      await validateEmployeePayrollFields(tx, orgId, parsed.data);
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
          employmentEndDate: parsed.data.employmentEndDate
            ? new Date(parsed.data.employmentEndDate)
            : null,
          contractEndDate: parsed.data.contractEndDate
            ? new Date(parsed.data.contractEndDate)
            : null,
          leavingReason: parsed.data.leavingReason || null,
          ptkpStatus: parsed.data.ptkpStatus || null,
          ptkpYear: parsed.data.ptkpYear ?? null,
          workWeekDays: parsed.data.workWeekDays,
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
                postingAccountId: item.postingAccountId || null,
                isFixed: item.isFixed ?? null,
              })),
              ...parsed.data.deductions.map((item) => ({
                type: 'DEDUCTION' as const,
                name: item.name,
                amount: item.amount,
                postingAccountId: item.postingAccountId || null,
                isFixed: item.isFixed ?? null,
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

    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'Employee',
      entityId: employee.id,
      action: 'CREATE',
      payload: { name: employee.name, employeeNo: employee.employeeNo },
    });
    return ok(serializeEmployee(employee), 201);
  },
);
