import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, err, listResponse, parsePaginationParams, logAudit, nextNumber } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { payrollRunInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'HR_PAYROLL', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20 });
  const status = searchParams.get('status');
  const year = searchParams.get('year') ? Number(searchParams.get('year')) : undefined;

  const where: any = { organizationId: orgId };
  if (status) where.status = status;
  if (year) where.year = year;

  const [data, total] = await Promise.all([
    prisma.payrollRun.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        _count: { select: { lines: true } },
      },
    }),
    prisma.payrollRun.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'HR_PAYROLL', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = payrollRunInputSchema.safeParse({ ...body, organizationId: orgId });
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);

  // Check for duplicate month/year
  const existing = await prisma.payrollRun.findUnique({
    where: {
      organizationId_month_year: {
        organizationId: orgId,
        month: parsed.data.month,
        year: parsed.data.year,
      },
    },
  });

  if (existing) {
    return err(`Payroll run for ${parsed.data.month}/${parsed.data.year} already exists`, 409);
  }

  const payrollRun = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'PayrollRun', 'number', 'PAY');

    return tx.payrollRun.create({
      data: {
        organizationId: orgId,
        number,
        month: parsed.data.month,
        year: parsed.data.year,
        periodStart: new Date(parsed.data.periodStart),
        periodEnd: new Date(parsed.data.periodEnd),
        status: 'DRAFT',
        notes: parsed.data.notes || null,
      },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PayrollRun', entityId: payrollRun.id, action: 'CREATE', payload: { month: parsed.data.month, year: parsed.data.year } });
  return ok(payrollRun, 201);
});
