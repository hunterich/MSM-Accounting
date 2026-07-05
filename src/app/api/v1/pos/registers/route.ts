import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { createPosRegisterSchema } from '@/types/api';

export const GET = withPermission({ module: 'POS_RETAIL', action: 'view' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const registers = await prisma.posRegister.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { code: 'asc' } });
  return ok(registers);
});

export const POST = withPermission({ module: 'POS_RETAIL', action: 'create' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const parsed = createPosRegisterSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid register payload', 400);
  const register = await prisma.posRegister.create({
    data: { organizationId: orgId, code: parsed.data.code, name: parsed.data.name, warehouseId: parsed.data.warehouseId ?? null, cashAccountId: parsed.data.cashAccountId ?? null },
  });
  return ok(register, 201);
});
