import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, nextNumber, ok, parsePaginationParams, requireOrg, validateForeignKey } from '@/lib/api-utils';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { createPurchaseReturnInputSchema } from '@/types/api';
import { preparePurchaseReturnValuation } from '@/lib/purchase-return-amounts';
import { assertReturnPreview } from '@/lib/note-return-value';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'AP_DEBITS', action: 'view' }, async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 100 });
  const status = searchParams.get('status');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;

  const search = searchParams.get('search');
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { vendor: { name: { contains: search, mode: 'insensitive' } } },
    { bill: { number: { contains: search, mode: 'insensitive' } } },
  ];
  const [data, total] = await Promise.all([
    prisma.purchaseReturn.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: [{ returnDate: 'desc' }, { id: 'desc' }],
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        bill: { select: { id: true, number: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    }),
    prisma.purchaseReturn.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'AP_DEBITS', action: 'create' }, async function POST(req: NextRequest) {
  const orgId = requireOrg(req);

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const userId = req.headers.get('x-user-id');
  if (!userId) return err('Unauthenticated', 401);
  const body = await req.json();
  const parsed = createPurchaseReturnInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid purchase return payload', 400);
  const { lines, expectedValuation, ...header } = parsed.data;

  const purchaseReturn = await prisma.$transaction(async (tx) => {
    // Tenant isolation: the vendor, the source bill, and every referenced line
    // item must belong to this org — otherwise they leak back through the GET
    // `include` joins (vendor / bill / lines.item).
    await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
    const returnItemIds = new Set((lines ?? []).map(line => line.itemId).filter((id): id is string => Boolean(id)));
    for (const itemId of returnItemIds) {
      await validateForeignKey(tx.item, { id: itemId, organizationId: orgId }, 'Item not found in organization');
    }
    const { lines: valuedLines, ...amounts } = await preparePurchaseReturnValuation(tx, orgId, { ...header, lines });
    assertReturnPreview(amounts, expectedValuation);
    const number = await nextNumber(tx, 'PurchaseReturn', 'number', 'PRN');
    const created = await tx.purchaseReturn.create({
      data: {
        ...header,
        ...amounts,
        number,
        organizationId: orgId,
        returnDate: new Date(header.returnDate),
        lines: valuedLines.length ? { create: valuedLines } : undefined,
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });

    // Post inventory leg if user creates as APPROVED directly. If the approval
    // engine routes the finalize for approval first, hold the return at
    // PENDING_APPROVAL and post NO GL.
    if (created.status === 'APPROVED') {
      const routed = await routeForApproval(tx, {
        orgId,
        userId,
        documentType: 'PURCHASE_RETURN',
        documentId: created.id,
      });
      if (routed) {
        await tx.purchaseReturn.update({
          where: { id: created.id },
          data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
        });
      } else {
        await postPurchaseReturnOnApproval(tx, created.id, dateOverride);
      }
    }

    return tx.purchaseReturn.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'PurchaseReturn', entityId: purchaseReturn.id, action: 'CREATE', payload: { number: purchaseReturn.number } });
  return ok(purchaseReturn, 201);
});
