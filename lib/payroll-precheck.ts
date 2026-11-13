import type { Prisma } from '@prisma/client';
const PTKP = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];
/** Read-only: show every affected employee before a payroll attempt or deployment. */
export async function payrollEmployeePrecheck(
  db: Pick<Prisma.TransactionClient, 'employee'>,
  orgId: string,
  year: number,
  month: number,
) {
  const start = new Date(Date.UTC(year, month - 1, 1)),
    end = new Date(Date.UTC(year, month, 0));
  const employees = await db.employee.findMany({
    where: { organizationId: orgId, joinDate: { lte: end } },
    select: {
      id: true,
      name: true,
      employeeNo: true,
      status: true,
      employmentEndDate: true,
      ptkpStatus: true,
      ptkpYear: true,
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return {
    year,
    month,
    inactiveWithoutEndDate: employees.filter(
      (e) => e.status === 'INACTIVE' && !e.employmentEndDate,
    ),
    ptkpNeedsConfirmation: employees.filter(
      (e) =>
        (e.employmentEndDate
          ? e.employmentEndDate >= start
          : e.status === 'ACTIVE') &&
        (!e.ptkpStatus || !PTKP.includes(e.ptkpStatus) || e.ptkpYear !== year),
    ),
  };
}
