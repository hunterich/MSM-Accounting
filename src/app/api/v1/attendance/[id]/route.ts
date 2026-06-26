import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateAttendanceRecordInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const record = await prisma.attendanceRecord.findFirst({
    where: { id, organizationId: orgId },
    include: {
      employee: { select: { id: true, name: true, employeeNo: true, department: { select: { name: true } } } },
    },
  });
  if (!record) return err('Not found', 404);
  return ok(record);
}

export const PUT = withPermission({ module: 'HR_ATTENDANCE', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateAttendanceRecordInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);

  const existing = await prisma.attendanceRecord.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return err('Not found', 404);

  const updateData: any = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.overtimeHours !== undefined) updateData.overtimeHours = parsed.data.overtimeHours;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.hoursWorked !== undefined) updateData.hoursWorked = parsed.data.hoursWorked;

  if (parsed.data.checkIn !== undefined) {
    const dateStr = existing.date.toISOString().slice(0, 10);
    updateData.checkIn = parsed.data.checkIn ? new Date(`${dateStr}T${parsed.data.checkIn}`) : null;
  }
  if (parsed.data.checkOut !== undefined) {
    const dateStr = existing.date.toISOString().slice(0, 10);
    updateData.checkOut = parsed.data.checkOut ? new Date(`${dateStr}T${parsed.data.checkOut}`) : null;
  }

  // Recalculate hours if check in/out changed
  if (updateData.checkIn !== undefined || updateData.checkOut !== undefined) {
    const checkIn = updateData.checkIn ?? existing.checkIn;
    const checkOut = updateData.checkOut ?? existing.checkOut;
    if (checkIn && checkOut) {
      const diff = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
      updateData.hoursWorked = Math.round(diff * 100) / 100;
    }
  }

  const updated = await prisma.attendanceRecord.update({
    where: { id },
    data: updateData,
    include: {
      employee: { select: { id: true, name: true, employeeNo: true } },
    },
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'AttendanceRecord', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
});

export const DELETE = withPermission({ module: 'HR_ATTENDANCE', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.attendanceRecord.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return err('Not found', 404);

  await prisma.attendanceRecord.delete({ where: { id } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'AttendanceRecord', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
});
