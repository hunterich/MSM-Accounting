import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { openPosShiftSchema } from '@/types/api';
import { openShift } from '@/lib/pos/shift';

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const shifts = await prisma.posShift.findMany({
    where: { organizationId: orgId, status: 'OPEN' },
    select: { id: true, registerId: true, openedAt: true, openingFloat: true },
    orderBy: { openedAt: 'desc' },
  });
  return ok(shifts.map((s) => ({ id: s.id, registerId: s.registerId, openedAt: s.openedAt, openingFloat: Number(s.openingFloat) })));
});

export const POST = withPermission({ module: 'POS_RETAIL', action: 'create' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) return err('Unauthenticated', 401);
  const parsed = openPosShiftSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid shift payload', 400);
  const result = await prisma.$transaction((tx) =>
    openShift(tx, orgId, { registerId: parsed.data.registerId, cashierId: userId, openingFloat: parsed.data.openingFloat, clientShiftId: parsed.data.clientShiftId }),
  );
  return ok(result, 201);
});
