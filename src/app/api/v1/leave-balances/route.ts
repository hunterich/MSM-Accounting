import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, listResponse, parsePaginationParams, logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50 });
  const employeeId = searchParams.get('employeeId');
  const year = searchParams.get('year') ? Number(searchParams.get('year')) : new Date().getFullYear();

  const where: any = { organizationId: orgId, year };
  if (employeeId) where.employeeId = employeeId;

  const [data, total] = await Promise.all([
    prisma.leaveBalance.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ employee: { name: 'asc' } }, { leaveType: { name: 'asc' } }],
      include: {
        employee: { select: { id: true, name: true, employeeNo: true } },
        leaveType: { select: { id: true, name: true, category: true } },
      },
    }),
    prisma.leaveBalance.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const year = body.year ?? new Date().getFullYear();
  const employeeIds: string[] | undefined = body.employeeIds;

  // Get all active leave types
  const leaveTypes = await prisma.leaveType.findMany({
    where: { organizationId: orgId, isActive: true },
  });

  if (leaveTypes.length === 0) {
    return ok({ error: 'No active leave types found. Create leave types first.' }, 400);
  }

  // Get target employees
  const employeeWhere: any = { organizationId: orgId, status: 'ACTIVE' };
  if (employeeIds) employeeWhere.id = { in: employeeIds };

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    select: { id: true, name: true },
  });

  // Get previous year balances for carry-over
  const prevBalances = await prisma.leaveBalance.findMany({
    where: {
      organizationId: orgId,
      year: year - 1,
      employeeId: { in: employees.map((e) => e.id) },
    },
    include: { leaveType: true },
  });

  const prevBalanceMap = new Map<string, typeof prevBalances[0]>();
  for (const b of prevBalances) {
    prevBalanceMap.set(`${b.employeeId}:${b.leaveTypeId}`, b);
  }

  let created = 0;
  let skipped = 0;

  for (const employee of employees) {
    for (const leaveType of leaveTypes) {
      // Check if balance already exists
      const existing = await prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year,
          },
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Calculate carry-over
      let carried = 0;
      if (leaveType.carryOver) {
        const prevBalance = prevBalanceMap.get(`${employee.id}:${leaveType.id}`);
        if (prevBalance && prevBalance.remaining > 0) {
          carried = Math.min(prevBalance.remaining, leaveType.maxCarryDays || prevBalance.remaining);
        }
      }

      await prisma.leaveBalance.create({
        data: {
          organizationId: orgId,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year,
          entitlement: leaveType.entitlementDays,
          used: 0,
          carried,
          remaining: leaveType.entitlementDays + carried,
        },
      });

      created++;
    }
  }

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'LeaveBalance',
    entityId: `year-${year}`,
    action: 'CREATE',
    payload: { year, created, skipped, employees: employees.length, leaveTypes: leaveTypes.length },
  });

  return ok({ created, skipped, year, employees: employees.length, leaveTypes: leaveTypes.length }, 201);
});
