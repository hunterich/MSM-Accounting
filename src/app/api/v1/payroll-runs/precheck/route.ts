import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPermission } from '@/lib/authz';
import { requireOrg, ok, err } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { payrollEmployeePrecheck } from '@/lib/payroll-precheck';
export const runtime = 'nodejs';
export const OPTIONS = () => corsPreflightResponse();
export const GET = withPermission(
  { module: 'HR_PAYROLL', action: 'view' },
  async (req: NextRequest) => {
    const year = Number(req.nextUrl.searchParams.get('year')),
      month = Number(req.nextUrl.searchParams.get('month'));
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    )
      return err('Select a valid payroll month and year.', 400);
    return ok(
      await payrollEmployeePrecheck(prisma, requireOrg(req), year, month),
    );
  },
);
