import { isDeepStrictEqual } from 'node:util';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  requireOrg,
  ok,
  err,
  listResponse,
  parsePaginationParams,
  logAudit,
  nextNumber,
} from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { ApiError } from '@/lib/api-utils';
import { lockPayroll } from '@/lib/payroll-posting';
import { payrollRunInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission(
  { module: 'HR_PAYROLL', action: 'view' },
  async function GET(req: NextRequest) {
    const orgId = requireOrg(req);
    const { searchParams, page, limit } = parsePaginationParams(req, {
      limit: 20,
    });
    const status = searchParams.get('status');
    const year = searchParams.get('year')
      ? Number(searchParams.get('year'))
      : undefined;

    const where: any = { organizationId: orgId };
    if (status) where.status = status;
    if (year) where.year = year;

    const [data, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { id: 'desc' }],
        include: {
          _count: { select: { lines: true } },
        },
      }),
      prisma.payrollRun.count({ where }),
    ]);

    return listResponse(data, total, page, limit);
  },
);

export const POST = withPermission(
  { module: 'HR_PAYROLL', action: 'create' },
  async function POST(req: NextRequest) {
    const orgId = requireOrg(req),
      parsed = payrollRunInputSchema.safeParse({
        ...(await req.json()),
        organizationId: orgId,
      });
    if (!parsed.success)
      return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
    const data = parsed.data;
    const start = new Date(Date.UTC(data.year, data.month - 1, 1)),
      end = new Date(Date.UTC(data.year, data.month, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const payDate = new Date(data.payDate ?? iso(end));
    if (
      data.periodStart !== iso(start) ||
      data.periodEnd !== iso(end) ||
      !Number.isFinite(payDate.getTime()) ||
      payDate < start ||
      payDate > end ||
      iso(payDate) !== (data.payDate ?? iso(end))
    )
      return err(
        'Payroll period must be the full selected calendar month; payment date must be a valid date inside that month.',
        422,
      );
    if (data.runType !== 'REGULAR' && !data.requestKey)
      return err(
        'Off-cycle payroll requires a request key to prevent duplicate creation on retries.',
        400,
      );
    if (
      ['THR', 'CORRECTION'].includes(data.runType) &&
      !data.adjustments.length
    )
      return err(
        'Enter employee earning adjustments for THR/correction payroll.',
        422,
      );
    if (data.runType === 'THR' && data.adjustments.some((a) => a.amount <= 0))
      return err('THR amounts must be positive.', 422);
    if (data.runType === 'CORRECTION' && !data.notes?.trim())
      return err('A correction reason is required.', 422);
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockPayroll(tx, orgId);
        if (data.requestKey) {
          const existing = await tx.payrollRun.findUnique({
            where: {
              organizationId_requestKey: {
                organizationId: orgId,
                requestKey: data.requestKey,
              },
            },
          });
          if (existing) {
            if (
              existing.month !== data.month ||
              existing.year !== data.year ||
              existing.runType !== data.runType ||
              existing.payDate?.getTime() !== payDate.getTime() ||
              !isDeepStrictEqual(existing.runInputs, {
                adjustments: data.adjustments,
              }) ||
              existing.notes !== (data.notes || null)
            )
              throw new ApiError(
                'This request key was already used for different payroll input.',
                409,
              );
            return { row: existing, replayed: true };
          }
        }
        if (
          data.runType === 'REGULAR' &&
          (await tx.payrollRun.findFirst({
            where: {
              organizationId: orgId,
              month: data.month,
              year: data.year,
              runType: 'REGULAR',
            },
          }))
        )
          throw new ApiError(
            'Regular payroll already exists for this month. Create an off-cycle THR, final-pay or correction run instead.',
            409,
          );
        const number = await nextNumber(tx, 'PayrollRun', 'number', 'PAY');
        const row = await tx.payrollRun.create({
          data: {
            organizationId: orgId,
            number,
            month: data.month,
            year: data.year,
            periodStart: start,
            periodEnd: end,
            payDate,
            status: 'DRAFT',
            notes: data.notes || null,
            runType: data.runType,
            requestKey: data.requestKey,
            runInputs: { adjustments: data.adjustments },
          },
        });
        return { row, replayed: false };
      });
      if (!result.replayed)
        logAudit({
          orgId,
          actorId: req.headers.get('x-user-id'),
          entityType: 'PayrollRun',
          entityId: result.row.id,
          action: 'CREATE',
          payload: {
            month: data.month,
            year: data.year,
            runType: data.runType,
          },
        });
      return ok(result.row, result.replayed ? 200 : 201);
    } catch (e) {
      return err(
        e instanceof Error ? e.message : 'Payroll creation failed',
        e instanceof ApiError ? e.status : 500,
      );
    }
  },
);
