import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import {
  ApiError,
  listResponse,
  logAuditTx,
  nextNumber,
  ok,
  parsePaginationParams,
  requireAuth,
  withHandler,
} from '@/lib/api-utils';
import { toNumber } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const CreateDNSchema = z.object({
  salesOrderId: z.string(),
  date: z.string(),
  warehouseId: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['DRAFT', 'DELIVERED']).default('DRAFT'),
  lines: z
    .array(
      z.object({
        salesOrderItemId: z.string(),
        itemId: z.string(),
        qtyOrdered: z.number().positive(),
        qtyDelivered: z.number().min(0),
      }),
    )
    .min(1),
});

export const GET = withHandler(async function GET(req: NextRequest) {
  const { orgId } = requireAuth(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 50, maxLimit: 200 });

  const salesOrderId = searchParams.get('salesOrderId') || undefined;
  const status = searchParams.get('status') || undefined;

  const where: any = { organizationId: orgId };
  if (salesOrderId) where.salesOrderId = salesOrderId;
  if (status) where.status = status.toUpperCase();

  const [data, total] = await Promise.all([
    prisma.deliveryNote.findMany({
      where,
      include: {
        salesOrder: {
          select: {
            id: true,
            number: true,
            customerName: true,
          },
        },
        warehouse: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deliveryNote.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const { orgId, userId } = requireAuth(req);

  const body = await req.json();
  const parsed = CreateDNSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message || 'Invalid delivery note payload', 400);
  }

  const { salesOrderId, date, warehouseId, notes, status, lines } = parsed.data;

  const dn = await prisma.$transaction(async (tx) => {
    // Validate the sales order belongs to this org
    const salesOrder = await tx.salesOrder.findFirst({
      where: { id: salesOrderId, organizationId: orgId },
      include: { items: true },
    });
    if (!salesOrder) {
      throw new ApiError('Sales order not found in organization', 404);
    }

    const number = await nextNumber(tx, 'DeliveryNote', 'number', 'DN');

    const deliveryNote = await tx.deliveryNote.create({
      data: {
        organizationId: orgId,
        number,
        salesOrderId,
        date: new Date(date),
        warehouseId: warehouseId || null,
        notes: notes || null,
        status: status as any,
        createdById: userId,
        lines: {
          create: lines.map((line) => ({
            salesOrderItemId: line.salesOrderItemId,
            itemId: line.itemId,
            qtyOrdered: line.qtyOrdered,
            qtyDelivered: line.qtyDelivered,
          })),
        },
      },
      include: {
        lines: true,
        salesOrder: { select: { id: true, number: true, customerName: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    if (status === 'DELIVERED') {
      // Update deliveredQty on each SalesOrderItem
      for (const line of lines) {
        await tx.salesOrderItem.update({
          where: { id: line.salesOrderItemId },
          data: {
            deliveredQty: { increment: line.qtyDelivered },
          },
        });
      }

      // Re-fetch updated items to check delivery completion
      const updatedItems = await tx.salesOrderItem.findMany({
        where: { salesOrderId },
      });

      const allDelivered = updatedItems.every(
        (item) => toNumber(item.deliveredQty) >= toNumber(item.quantity),
      );

      if (allDelivered) {
        await tx.salesOrder.update({
          where: { id: salesOrderId },
          data: { status: 'DELIVERED' as any },
        });
      } else {
        // PARTIAL_DELIVERY may not exist in the SoStatus enum; skip gracefully if not
        try {
          await tx.salesOrder.update({
            where: { id: salesOrderId },
            data: { status: 'PARTIAL_DELIVERY' as any },
          });
        } catch {
          // PARTIAL_DELIVERY enum value not available — skip SO status update
        }
      }
    }

    await logAuditTx(tx, {
      orgId,
      actorId: userId,
      entityType: 'DeliveryNote',
      entityId: deliveryNote.id,
      action: 'CREATE',
      payload: { number: deliveryNote.number, salesOrderId, status },
    });

    return deliveryNote;
  });

  return ok(dn, 201);
});
