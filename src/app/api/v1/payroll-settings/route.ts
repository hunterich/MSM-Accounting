import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withPermission } from '@/lib/authz';
import { ok, err, requireOrg, ApiError, logAudit } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import {
  payrollRulesSchema,
  policyCoversMarchCycle,
} from '@/lib/payroll-rules';
import { lockPayroll } from '@/lib/payroll-posting';
export const runtime = 'nodejs';
export const OPTIONS = () => corsPreflightResponse();
const schema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rules: payrollRulesSchema,
});
export const GET = withPermission(
  { module: 'HR_PAYROLL', action: 'view' },
  async (req: NextRequest) =>
    ok(
      await prisma.payrollPolicy.findMany({
        where: { organizationId: requireOrg(req) },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ),
);
export const POST = withPermission(
  { module: 'SETTINGS', action: 'edit' },
  async (req: NextRequest) => {
    const orgId = requireOrg(req),
      parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return err(
        parsed.error.issues[0]?.message || 'Invalid payroll settings',
        400,
      );
    const from = new Date(parsed.data.effectiveFrom),
      until = new Date(parsed.data.validUntil);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(until.getTime()) ||
      from.toISOString().slice(0, 10) !== parsed.data.effectiveFrom ||
      until.toISOString().slice(0, 10) !== parsed.data.validUntil ||
      from.getUTCDate() !== 1 ||
      until.getUTCDate() !==
        new Date(
          Date.UTC(until.getUTCFullYear(), until.getUTCMonth() + 1, 0),
        ).getUTCDate() ||
      !policyCoversMarchCycle(from, until)
    )
      return err(
        'Policy dates must start/end on calendar-month boundaries and stay within one March–February JP ceiling cycle. Add a new policy for the next March.',
        422,
      );
    try {
      const row = await prisma.$transaction(async (tx) => {
        await lockPayroll(tx, orgId);
        if (
          await tx.payrollPolicy.findFirst({
            where: {
              organizationId: orgId,
              effectiveFrom: { lte: until },
              validUntil: { gte: from },
            },
          })
        )
          throw new ApiError(
            'A payroll policy already covers these dates. Policies are immutable; add a non-overlapping future policy.',
            409,
          );
        return tx.payrollPolicy.create({
          data: {
            organizationId: orgId,
            effectiveFrom: from,
            validUntil: until,
            rules: parsed.data.rules,
          },
        });
      });
      logAudit({
        orgId,
        actorId: req.headers.get('x-user-id'),
        entityType: 'PayrollPolicy',
        entityId: row.id,
        action: 'CREATE',
        payload: {
          effectiveFrom: parsed.data.effectiveFrom,
          validUntil: parsed.data.validUntil,
        },
      });
      return ok(row, 201);
    } catch (e) {
      return err(
        e instanceof Error ? e.message : 'Cannot save payroll policy',
        e instanceof ApiError ? e.status : 500,
      );
    }
  },
);
