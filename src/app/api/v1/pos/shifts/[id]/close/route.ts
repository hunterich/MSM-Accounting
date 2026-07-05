import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { closePosShiftSchema } from '@/types/api';
import { closeShift } from '@/lib/pos/shift';

export const POST = withPermission(
  { module: 'POS_RETAIL', action: 'edit' },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return err('Unauthenticated', 401);
    const { id } = await params;
    const parsed = closePosShiftSchema.safeParse(await req.json());
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid close payload', 400);
    const result = await prisma.$transaction((tx) => closeShift(tx, orgId, { shiftId: id, countedCash: parsed.data.countedCash }));
    return ok(result);
  },
);
