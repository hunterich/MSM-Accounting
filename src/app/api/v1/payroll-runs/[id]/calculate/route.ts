import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { calculatePayroll } from '@/lib/payroll-calculation';
export const runtime = 'nodejs';
export function OPTIONS() {
  return corsPreflightResponse();
}
export const POST = withPermission(
  { module: 'HR_PAYROLL', action: 'create' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params,
      orgId = req.headers.get('x-org-id')!;
    try {
      const run = await prisma.$transaction(
        (tx) => calculatePayroll(tx, orgId, id),
        { timeout: 60000 },
      );
      logAudit({
        orgId,
        actorId: req.headers.get('x-user-id'),
        entityType: 'PayrollRun',
        entityId: id,
        action: 'UPDATE',
        payload: { action: 'CALCULATE', employees: run.lines.length },
      });
      return ok(run);
    } catch (e) {
      return err(
        e instanceof Error ? e.message : 'Payroll calculation failed',
        e instanceof ApiError ? e.status : 422,
      );
    }
  },
);
