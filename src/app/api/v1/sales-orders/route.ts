// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(200, Number(searchParams.get('limit') ?? 50));
    const status = searchParams.get('status') || undefined;

    const where: any = { organizationId: orgId };
    if (status) where.status = status.toUpperCase();

    const [data, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.salesOrder.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list sales orders';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const body = await req.json();
    const { customerName, customerId, issueDate, expiryDate, number, notes, items = [] } = body;
    if (!customerName) return withCors(NextResponse.json({ error: 'customerName required' }, { status: 400 }));

    const so = await prisma.salesOrder.create({
      data: {
        organizationId: orgId,
        customerName,
        customerId: customerId || null,
        issueDate:  issueDate  ? new Date(issueDate)  : new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        number:     number     || null,
        notes:      notes      || null,
        status:     'DRAFT',
        items: {
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
      },
      include: { items: true },
    });

    logAudit({ orgId, actorId: userId, entityType: 'SalesOrder', entityId: so.id, action: 'CREATE' });
    return withCors(NextResponse.json(so, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
