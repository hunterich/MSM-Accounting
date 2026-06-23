import type { Prisma } from '@prisma/client';
import { nextNumber, ApiError } from '@/lib/api-utils';

/**
 * Posts the payroll-run summary journal entry and links it to the run.
 * Extracted from payroll-runs/[id]/post. Must run inside a $transaction.
 * Loads the run + its lines from `tx`. Sets payrollRun.journalEntryId but does
 * NOT set payrollRun.status — the caller sets POSTED (mirrors postInvoiceSend).
 * Returns the created journal entry id.
 */
export async function postPayrollRunToLedger(
  tx: Prisma.TransactionClient,
  orgId: string,
  payrollRunId: string,
): Promise<{ journalEntryId: string }> {
  const payrollRun = await tx.payrollRun.findFirst({
    where: { id: payrollRunId, organizationId: orgId },
    include: {
      lines: {
        include: {
          employee: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!payrollRun) throw new ApiError('Payroll run not found', 404);

  // Find the required accounts
  const [salaryExpenseAccount, bankAccount, taxPayableAccount, bpjsPayableAccount] = await Promise.all([
    tx.account.findFirst({ where: { organizationId: orgId, code: '5100', isActive: true } }),
    tx.account.findFirst({ where: { organizationId: orgId, type: 'ASSET', reportGroup: { contains: 'Cash' }, isActive: true } }),
    tx.account.findFirst({ where: { organizationId: orgId, code: '2300', isActive: true } }),
    tx.account.findFirst({ where: { organizationId: orgId, code: '2310', isActive: true } }),
  ]);

  // Use fallback accounts if specific codes not found
  const expenseAcct = salaryExpenseAccount
    || await tx.account.findFirst({ where: { organizationId: orgId, type: 'EXPENSE', isActive: true } });
  const cashAcct = bankAccount
    || await tx.account.findFirst({ where: { organizationId: orgId, type: 'ASSET', isActive: true, isPostable: true } });
  const taxAcct = taxPayableAccount
    || await tx.account.findFirst({ where: { organizationId: orgId, type: 'LIABILITY', isActive: true, isPostable: true } });
  const bpjsAcct = bpjsPayableAccount || taxAcct;

  if (!expenseAcct || !cashAcct || !taxAcct) {
    throw new ApiError('Required GL accounts not found (Salary Expense, Cash/Bank, Tax Payable). Please set up chart of accounts first.', 400);
  }

  const totalGross = Number(payrollRun.totalGross);
  const totalNet = Number(payrollRun.totalNet);
  const totalTax = Number(payrollRun.totalTax);
  const totalBpjsEmployee = payrollRun.lines.reduce((sum, l) => sum + Number(l.totalBpjsEmployee), 0);
  const totalBpjsEmployer = payrollRun.lines.reduce((sum, l) => sum + Number(l.totalBpjsEmployer), 0);
  const totalDeductions = payrollRun.lines.reduce((sum, l) => sum + Number(l.totalDeductions), 0);

  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const memo = `Payroll ${monthNames[payrollRun.month]} ${payrollRun.year} - ${payrollRun.number}`;

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

  // Link the journal entry to the payroll run (status set by caller).
  await tx.payrollRun.update({
    where: { id: payrollRunId },
    data: { journalEntryId: journalEntry.id },
  });

  return { journalEntryId: journalEntry.id };
}
