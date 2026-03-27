// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const so = await prisma.salesOrder.findFirst({
      where: { id: params.id, organizationId: orgId },
      include: { items: true },
    });
    if (!so) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(so));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const body = await req.json();
    const { customerName, customerId, issueDate, expiryDate, number, notes, status, items } = body;

    const existing = await prisma.salesOrder.findFirst({ where: { id: params.id, organizationId: orgId } });
    if (!existing) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    const updated = await prisma.salesOrder.update({
      where: { id: params.id },
      data: {
        ...(customerName !== undefined && { customerName }),
        ...(customerId  !== undefined && { customerId }),
        ...(issueDate   !== undefined && { issueDate:  new Date(issueDate) }),
        ...(expiryDate  !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
        ...(number      !== undefined && { number }),
        ...(notes       !== undefined && { notes }),
        ...(status      !== undefined && { status: status.toUpperCase() }),
        ...(items       !== undefined && {
          items: {
            deleteMany: {},
            create: items.map((item: any) => ({
              productId:   item.productId   || null,
              code:        item.code        || null,
              description: item.description || '',
              quantity:    item.quantity    ?? 1,
              unit:        item.unit        || 'PCS',
              price:       item.price       ?? 0,
              discount:    item.discount    ?? 0,
            })),
          },
        }),
      },
      include: { items: true },
    });

    logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: params.id, action: 'UPDATE' });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const existing = await prisma.salesOrder.findFirst({ where: { id: params.id, organizationId: orgId } });
    if (!existing) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    await prisma.salesOrder.delete({ where: { id: params.id } });
    logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: params.id, action: 'DELETE' });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
