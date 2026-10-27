import { ApiError } from './api-utils';
import type { Prisma } from '@prisma/client';
export async function validateEmployeePayrollFields(
  tx: Prisma.TransactionClient,
  orgId: string,
  data: {
    joinDate?: string;
    employmentEndDate?: string | null;
    contractEndDate?: string | null;
    status?: string;
    type?: string;
  },
  existing?: {
    id: string;
    joinDate: Date;
    employmentEndDate: Date | null;
    contractEndDate: Date | null;
    status: string;
  },
) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  for (const v of [data.joinDate, data.employmentEndDate, data.contractEndDate])
    if (v && !valid(v))
      throw new ApiError(
        'Employment dates must be valid YYYY-MM-DD dates.',
        422,
      );
  const joined = data.joinDate ? new Date(data.joinDate) : existing?.joinDate;
  const ended =
    data.employmentEndDate === undefined
      ? existing?.employmentEndDate
      : data.employmentEndDate
        ? new Date(data.employmentEndDate)
        : null;
  const contract =
    data.contractEndDate === undefined
      ? existing?.contractEndDate
      : data.contractEndDate
        ? new Date(data.contractEndDate)
        : null;
  if (joined && ((ended && ended < joined) || (contract && contract < joined)))
    throw new ApiError(
      'Contract/end dates cannot be before the joining date.',
      422,
    );
  if ((data.status ?? existing?.status) === 'INACTIVE' && !ended)
    throw new ApiError(
      'Set the last working day before marking an employee inactive, so historical/final payroll stays eligible.',
      422,
    );
  if (
    existing &&
    data.joinDate &&
    new Date(data.joinDate).getTime() !== existing.joinDate.getTime() &&
    (await tx.payrollLine.findFirst({
      where: {
        employeeId: existing.id,
        payrollRun: { organizationId: orgId, status: 'POSTED' },
      },
    }))
  )
    throw new ApiError(
      'Joining date is used by posted payroll. Preserve the historical record; use a separate employee record for a rehire.',
      409,
    );
  if (
    existing?.employmentEndDate &&
    data.employmentEndDate !== undefined &&
    ended?.getTime() !== existing.employmentEndDate.getTime() &&
    (await tx.payrollLine.findFirst({
      where: {
        employeeId: existing.id,
        payrollRun: {
          organizationId: orgId,
          status: 'POSTED',
          periodEnd: { gte: existing.employmentEndDate },
        },
      },
    }))
  )
    throw new ApiError(
      'Final payroll already uses this leaving date. Resolve the final-pay correction before changing it.',
      409,
    );
}
