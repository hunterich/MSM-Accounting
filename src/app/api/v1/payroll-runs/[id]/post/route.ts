import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { postPayrollRunToLedger } from '@/lib/payroll-posting';
import { routeForApproval } from '@/lib/approval/engine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission({ module: 'HR_PAYROLL', action: 'create' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) return err('Unauthenticated', 401);

  try {
    const payrollRun = await prisma.payrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lines: {
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!payrollRun) return err('Payroll run not found', 404);
    if (payrollRun.status === 'POSTED') return err('Payroll run already posted', 400);
    if (payrollRun.status === 'DRAFT') return err('Must calculate payroll before posting', 400);
    if (payrollRun.lines.length === 0) return err('No payroll lines to post', 400);

    // Find the required accounts
    const [salaryExpenseAccount, bankAccount, taxPayableAccount, bpjsPayableAccount] = await Promise.all([
      prisma.account.findFirst({ where: { organizationId: orgId, code: '5100', isActive: true } }),
      prisma.account.findFirst({ where: { organizationId: orgId, type: 'ASSET', reportGroup: { contains: 'Cash' }, isActive: true } }),
      prisma.account.findFirst({ where: { organizationId: orgId, code: '2300', isActive: true } }),
      prisma.account.findFirst({ where: { organizationId: orgId, code: '2310', isActive: true } }),
    ]);

    // Use fallback accounts if specific codes not found
    const expenseAcct = salaryExpenseAccount
      || await prisma.account.findFirst({ where: { organizationId: orgId, type: 'EXPENSE', isActive: true } });
    const cashAcct = bankAccount
      || await prisma.account.findFirst({ where: { organizationId: orgId, type: 'ASSET', isActive: true, isPostable: true } });
    const taxAcct = taxPayableAccount
      || await prisma.account.findFirst({ where: { organizationId: orgId, type: 'LIABILITY', isActive: true, isPostable: true } });
    const bpjsAcct = bpjsPayableAccount || taxAcct;

    if (!expenseAcct || !cashAcct || !taxAcct) {
      return err('Required GL accounts not found (Salary Expense, Cash/Bank, Tax Payable). Please set up chart of accounts first.', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Auto-route the post (→ POSTED) through the approval engine. If approval
      // is required, hold the run at PENDING_APPROVAL and post NO GL.
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'PAYROLL_RUN',
        documentId: id,
      });
      if (routed) {
        const held = await tx.payrollRun.update({
          where: { id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
        return { payrollRun: held, journalEntry: null };
      }

      const { journalEntryId } = await postPayrollRunToLedger(tx, orgId, id);

      // The route still sets POSTED — only the JE construction moved.
      const updated = await tx.payrollRun.update({
        where: { id },
        data: { status: 'POSTED', journalEntryId },
      });

      const journalEntry = await tx.journalEntry.findUniqueOrThrow({
        where: { id: journalEntryId },
        select: { id: true, entryNo: true },
      });

      return { payrollRun: updated, journalEntry: { id: journalEntry.id, entryNo: journalEntry.entryNo } };
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'PayrollRun',
      entityId: id,
      action: 'UPDATE',
      payload: { action: 'POST', journalEntryId: result.journalEntry?.id ?? null },
    });

    return ok(result);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to post payroll';
    return err(message, 500);
  }
});
