import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit, nextNumber, ApiError } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;

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

    const totalGross = Number(payrollRun.totalGross);
    const totalNet = Number(payrollRun.totalNet);
    const totalTax = Number(payrollRun.totalTax);
    const totalBpjsEmployee = payrollRun.lines.reduce((sum, l) => sum + Number(l.totalBpjsEmployee), 0);
    const totalBpjsEmployer = payrollRun.lines.reduce((sum, l) => sum + Number(l.totalBpjsEmployer), 0);
    const totalDeductions = payrollRun.lines.reduce((sum, l) => sum + Number(l.totalDeductions), 0);

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const memo = `Payroll ${monthNames[payrollRun.month]} ${payrollRun.year} - ${payrollRun.number}`;

    const result = await prisma.$transaction(async (tx) => {
      const entryNo = await nextNumber(tx, 'JournalEntry', 'entryNo', 'JE');

      // Build journal lines
      const journalLines: any[] = [];
      let lineNo = 1;

      // Debit: Salary Expense (total gross + employer BPJS)
      journalLines.push({
        lineNo: lineNo++,
        accountId: expenseAcct.id,
        description: `Beban Gaji - ${memo}`,
        debit: totalGross + totalBpjsEmployer,
        credit: 0,
      });

      // Credit: Cash/Bank (net pay)
      journalLines.push({
        lineNo: lineNo++,
        accountId: cashAcct.id,
        description: `Pembayaran Gaji - ${memo}`,
        debit: 0,
        credit: totalNet,
      });

      // Credit: Tax Payable (PPh 21)
      if (totalTax > 0) {
        journalLines.push({
          lineNo: lineNo++,
          accountId: taxAcct.id,
          description: `Hutang PPh 21 - ${memo}`,
          debit: 0,
          credit: totalTax,
        });
      }

      // Credit: BPJS Payable (employee + employer)
      const totalBpjsAll = totalBpjsEmployee + totalBpjsEmployer;
      if (totalBpjsAll > 0) {
        journalLines.push({
          lineNo: lineNo++,
          accountId: (bpjsAcct || taxAcct).id,
          description: `Hutang BPJS - ${memo}`,
          debit: 0,
          credit: totalBpjsAll,
        });
      }

      // Credit: Deductions (employee deductions) - goes to cash
      if (totalDeductions > 0) {
        journalLines.push({
          lineNo: lineNo++,
          accountId: cashAcct.id,
          description: `Potongan Gaji - ${memo}`,
          debit: 0,
          credit: totalDeductions,
        });
      }

      const totalDebit = journalLines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = journalLines.reduce((s, l) => s + l.credit, 0);

      // Create journal entry
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId: orgId,
          entryNo,
          date: payrollRun.periodEnd,
          memo,
          source: 'SYSTEM',
          status: 'POSTED',
          totalDebit,
          totalCredit,
          postedAt: new Date(),
          lines: { create: journalLines },
        },
      });

      // Update payroll run
      const updated = await tx.payrollRun.update({
        where: { id },
        data: {
          status: 'POSTED',
          journalEntryId: journalEntry.id,
        },
      });

      return { payrollRun: updated, journalEntry: { id: journalEntry.id, entryNo: journalEntry.entryNo } };
    });

    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'PayrollRun',
      entityId: id,
      action: 'UPDATE',
      payload: { action: 'POST', journalEntryId: result.journalEntry.id },
    });

    return ok(result);
  } catch (error) {
    if (error instanceof ApiError) return err(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to post payroll';
    return err(message, 500);
  }
}
