import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, listResponse, parsePaginationParams, logAudit } from '@/lib/api-utils';
import { leaveRequestInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20 });
  const employeeId = searchParams.get('employeeId');
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true } },
        leaveType: { select: { id: true, name: true, category: true } },
      },
    }),
    prisma.leaveRequest.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = leaveRequestInputSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) return ok({ error: parsed.error.issues[0]?.message }, 400);

  // Validate leave balance
  const year = new Date(parsed.data.startDate).getFullYear();
  const balance = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: parsed.data.employeeId,
        leaveTypeId: parsed.data.leaveTypeId,
        year,
      },
    },
  });

  if (balance && balance.remaining < parsed.data.totalDays) {
    return ok({ error: `Insufficient leave balance. Available: ${balance.remaining}, Requested: ${parsed.data.totalDays}` }, 400);
  }

  const created = await prisma.leaveRequest.create({
    data: {
      organizationId: orgId,
      employeeId: parsed.data.employeeId,
      leaveTypeId: parsed.data.leaveTypeId,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      totalDays: parsed.data.totalDays,
      reason: parsed.data.reason || null,
      status: 'PENDING',
    },
    include: {
      employee: { select: { id: true, name: true, employeeNo: true } },
      leaveType: { select: { id: true, name: true, category: true } },
    },
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveRequest', entityId: created.id, action: 'CREATE', payload: { employeeId: created.employeeId, totalDays: created.totalDays } });
  return ok(created, 201);
});
