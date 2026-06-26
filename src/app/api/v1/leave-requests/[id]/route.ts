import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateLeaveRequestInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const record = await prisma.leaveRequest.findFirst({
    where: { id, organizationId: orgId },
    include: {
      employee: { select: { id: true, name: true, employeeNo: true } },
      leaveType: { select: { id: true, name: true, category: true } },
    },
  });
  if (!record) return err('Not found', 404);
  return ok(record);
}

export const PUT = withPermission({ module: 'HR_ATTENDANCE', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  const parsed = updateLeaveRequestInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);

  const existing = await prisma.leaveRequest.findFirst({
    where: { id, organizationId: orgId },
    include: { leaveType: true },
  });
  if (!existing) return err('Not found', 404);

  // Handle status transitions
  if (parsed.data.status && parsed.data.status !== existing.status) {
    // Approve: decrement leave balance
    if (parsed.data.status === 'APPROVED' && existing.status === 'PENDING') {
      const year = existing.startDate.getFullYear();

      await prisma.$transaction(async (tx) => {
        // Update leave balance
        const balance = await tx.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: existing.employeeId,
              leaveTypeId: existing.leaveTypeId,
              year,
            },
          },
        });

        if (balance) {
          if (balance.remaining < existing.totalDays) {
            throw new Error(`Insufficient leave balance. Available: ${balance.remaining}, Requested: ${existing.totalDays}`);
          }

          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: {
              used: { increment: existing.totalDays },
              remaining: { decrement: existing.totalDays },
            },
          });
        }

        // Update leave request
        await tx.leaveRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            reviewedById: req.headers.get('x-user-id'),
            reviewedAt: new Date(),
            reviewNote: parsed.data.reviewNote || null,
          },
        });
      });

      logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveRequest', entityId: id, action: 'UPDATE', payload: { status: 'APPROVED' } });
      const updated = await prisma.leaveRequest.findFirst({
        where: { id },
        include: {
          employee: { select: { id: true, name: true, employeeNo: true } },
          leaveType: { select: { id: true, name: true, category: true } },
        },
      });
      return ok(updated);
    }

    // Reject
    if (parsed.data.status === 'REJECTED' && existing.status === 'PENDING') {
      const updated = await prisma.leaveRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedById: req.headers.get('x-user-id'),
          reviewedAt: new Date(),
          reviewNote: parsed.data.reviewNote || null,
        },
        include: {
          employee: { select: { id: true, name: true, employeeNo: true } },
          leaveType: { select: { id: true, name: true, category: true } },
        },
      });

      logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveRequest', entityId: id, action: 'UPDATE', payload: { status: 'REJECTED' } });
      return ok(updated);
    }

    // Cancel (only pending or approved)
    if (parsed.data.status === 'CANCELLED' && (existing.status === 'PENDING' || existing.status === 'APPROVED')) {
      // If was approved, restore leave balance
      if (existing.status === 'APPROVED') {
        const year = existing.startDate.getFullYear();
        await prisma.leaveBalance.updateMany({
          where: {
            employeeId: existing.employeeId,
            leaveTypeId: existing.leaveTypeId,
            year,
          },
          data: {
            used: { decrement: existing.totalDays },
            remaining: { increment: existing.totalDays },
          },
        });
      }

      const updated = await prisma.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: {
          employee: { select: { id: true, name: true, employeeNo: true } },
          leaveType: { select: { id: true, name: true, category: true } },
        },
      });

      logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveRequest', entityId: id, action: 'UPDATE', payload: { status: 'CANCELLED' } });
      return ok(updated);
    }
  }

  // Generic field updates (only for PENDING requests)
  if (existing.status !== 'PENDING') {
    return err('Can only edit pending leave requests', 400);
  }

  const updateData: any = {};
  if (parsed.data.reason !== undefined) updateData.reason = parsed.data.reason;
  if (parsed.data.startDate) updateData.startDate = new Date(parsed.data.startDate);
  if (parsed.data.endDate) updateData.endDate = new Date(parsed.data.endDate);
  if (parsed.data.totalDays) updateData.totalDays = parsed.data.totalDays;
  if (parsed.data.leaveTypeId) updateData.leaveTypeId = parsed.data.leaveTypeId;

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: updateData,
    include: {
      employee: { select: { id: true, name: true, employeeNo: true } },
      leaveType: { select: { id: true, name: true, category: true } },
    },
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveRequest', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
});

export const DELETE = withPermission({ module: 'HR_ATTENDANCE', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.leaveRequest.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'PENDING') return err('Can only delete pending leave requests', 400);

  await prisma.leaveRequest.delete({ where: { id } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'LeaveRequest', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
});
