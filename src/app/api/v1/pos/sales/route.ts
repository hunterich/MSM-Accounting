import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { createPosSaleSchema } from '@/types/api';
import { postPosSale } from '@/lib/pos/sale-posting';

export const POST = withPermission({ module: 'POS_RETAIL', action: 'create' }, async (req: NextRequest) => {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) return err('Unauthenticated', 401);
  const parsed = createPosSaleSchema.safeParse(await req.json());
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid sale payload', 400);

  const result = await prisma.$transaction((tx) =>
    postPosSale(tx, orgId, {
      clientSaleId: parsed.data.clientSaleId,
      registerId: parsed.data.registerId,
      shiftId: parsed.data.shiftId,
      salesTypeId: parsed.data.salesTypeId,
      cashierId: userId,
      warehouseId: null,
      lines: parsed.data.lines,
      tenders: parsed.data.tenders,
      date: new Date(),
    }),
  );

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'PosSale',
    entityId: result.posSaleId,
    action: 'CREATE',
    payload: { clientSaleId: parsed.data.clientSaleId, total: result.totalAmount },
  });
  return ok(result, 201);
});
