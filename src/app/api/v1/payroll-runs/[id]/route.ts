import { lockPayroll } from '@/lib/payroll-posting';
import { ApiError } from '@/lib/api-utils';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission(
  { module: 'HR_PAYROLL', action: 'view' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const orgId = req.headers.get('x-org-id')!;
    const payrollRun = await prisma.payrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lines: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                employeeNo: true,
                department: { select: { name: true } },
              },
            },
          },
          orderBy: { employee: { name: 'asc' } },
        },
      },
    });
    if (!payrollRun) return err('Not found', 404);
    return ok(payrollRun);
  },
);

export const PUT = withPermission(
  { module: 'HR_PAYROLL', action: 'edit' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params,
      orgId = req.headers.get('x-org-id')!;
    const parsed = z
      .object({
        notes: z.string().max(4000).optional(),
        status: z.literal('REVIEWED').optional(),
      })
      .safeParse(await req.json());
    if (!parsed.success)
      return err('Only notes and the reviewed transition can be edited.', 400);
    try {
      const updated = await prisma.$transaction(async (tx) => {
        await lockPayroll(tx, orgId);
        const run = await tx.payrollRun.findFirst({
          where: { id, organizationId: orgId },
        });
        if (!run) throw new ApiError('Not found', 404);
        if (
          !['DRAFT', 'CALCULATED', 'REVIEWED'].includes(run.status) ||
          run.journalEntryId
        )
          throw new ApiError(
            'Pending approval and posted payroll are frozen. Use a correction after posting.',
            409,
          );
        if (
          parsed.data.status === 'REVIEWED' &&
          (run.status === 'DRAFT' ||
            (Array.isArray(run.reviewIssues) && run.reviewIssues.length))
        )
          throw new ApiError(
            'Calculate payroll and resolve its review issues before marking it reviewed.',
            422,
          );
        return tx.payrollRun.update({ where: { id }, data: parsed.data });
      });
      logAudit({
        orgId,
        actorId: req.headers.get('x-user-id'),
        entityType: 'PayrollRun',
        entityId: id,
        action: 'UPDATE',
        payload: parsed.data,
      });
      return ok(updated);
    } catch (e) {
      return err(
        e instanceof Error ? e.message : 'Payroll update failed',
        e instanceof ApiError ? e.status : 500,
      );
    }
  },
);
export const DELETE = withPermission(
  { module: 'HR_PAYROLL', action: 'delete' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params,
      orgId = req.headers.get('x-org-id')!;
    try {
      await prisma.$transaction(async (tx) => {
        await lockPayroll(tx, orgId);
        const run = await tx.payrollRun.findFirst({
          where: { id, organizationId: orgId },
        });
        if (!run) throw new ApiError('Not found', 404);
        if (run.status !== 'DRAFT' || run.journalEntryId)
          throw new ApiError(
            'Only draft payroll can be deleted; calculated, pending and posted history is preserved.',
            409,
          );
        await tx.payrollRun.delete({ where: { id } });
      });
      logAudit({
        orgId,
        actorId: req.headers.get('x-user-id'),
        entityType: 'PayrollRun',
        entityId: id,
        action: 'DELETE',
        payload: null,
      });
      return ok({ deleted: true });
    } catch (e) {
      return err(
        e instanceof Error ? e.message : 'Payroll deletion failed',
        e instanceof ApiError ? e.status : 500,
      );
    }
  },
);
