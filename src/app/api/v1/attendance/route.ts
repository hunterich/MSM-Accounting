import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, listResponse, parsePaginationParams, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { attendanceRecordInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 200 });
  const employeeId = searchParams.get('employeeId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [data, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ date: 'desc' }, { employee: { name: 'asc' } }],
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, department: { select: { name: true } } } },
      },
    }),
    prisma.attendanceRecord.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'HR_ATTENDANCE', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  // Support bulk creation
  const records = Array.isArray(body) ? body : [body];
  const results: any[] = [];

  for (const record of records) {
    const parsed = attendanceRecordInputSchema.safeParse({
      ...record,
      organizationId: orgId,
    });
    if (!parsed.success) {
      return ok({ error: parsed.error.issues[0]?.message || 'Invalid attendance payload', record }, 400);
    }

    const data: any = {
      organizationId: orgId,
      employeeId: parsed.data.employeeId,
      date: new Date(parsed.data.date),
      status: parsed.data.status,
      overtimeHours: parsed.data.overtimeHours,
      notes: parsed.data.notes || null,
    };

    if (parsed.data.checkIn) data.checkIn = new Date(`${parsed.data.date}T${parsed.data.checkIn}`);
    if (parsed.data.checkOut) data.checkOut = new Date(`${parsed.data.date}T${parsed.data.checkOut}`);

    // Calculate hours worked if both check in and out provided
    if (data.checkIn && data.checkOut) {
      const diff = (data.checkOut.getTime() - data.checkIn.getTime()) / (1000 * 60 * 60);
      data.hoursWorked = Math.round(diff * 100) / 100;
    } else if (parsed.data.hoursWorked !== undefined) {
      data.hoursWorked = parsed.data.hoursWorked;
    }

    const created = await prisma.attendanceRecord.upsert({
      where: {
        employeeId_date: {
          employeeId: parsed.data.employeeId,
          date: new Date(parsed.data.date),
        },
      },
      create: data,
      update: {
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        hoursWorked: data.hoursWorked,
        overtimeHours: data.overtimeHours,
        status: data.status,
        notes: data.notes,
      },
      include: {
        employee: { select: { id: true, name: true, employeeNo: true } },
      },
    });

    results.push(created);
  }

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AttendanceRecord',
    entityId: results[0]?.id || '',
    action: 'CREATE',
    payload: { count: results.length },
  });

  return ok(Array.isArray(body) ? results : results[0], 201);
});
