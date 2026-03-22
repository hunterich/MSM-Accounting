// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { nextNumber } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(100, Number(searchParams.get('limit') ?? 50));
    const status = searchParams.get('status');

    const where: any = { organizationId: orgId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.purchaseReturn.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { returnDate: 'desc' },
        include: {
          vendor: { select: { id: true, name: true, code: true } },
          bill: { select: { id: true, number: true } },
          lines: { include: { item: { select: { id: true, name: true } } } },
        },
      }),
      prisma.purchaseReturn.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list purchase returns';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const { lines, ...header } = body;

    const purchaseReturn = await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, 'PurchaseReturn', 'number', 'PRN');
      return tx.purchaseReturn.create({
        data: {
          ...header,
          number,
          organizationId: orgId,
          returnDate: new Date(header.returnDate),
          subtotal:    Number(header.subtotal    ?? 0),
          taxAmount:   Number(header.taxAmount   ?? 0),
          totalAmount: Number(header.totalAmount ?? 0),
          taxRate:     Number(header.taxRate     ?? 11),
          lines: lines?.length ? {
            create: lines.map((l: any, idx: number) => ({
              lineNo:       idx + 1,
              lineKey:      l.lineKey || null,
              itemId:       l.itemId || null,
              description:  l.description || '',
              qtyPurchased: Number(l.qtyPurchased ?? 0),
              qtyReturn:    Number(l.qtyReturn ?? 0),
              unit:         l.unit || 'PCS',
              price:        Number(l.price ?? 0),
              lineTotal:    Number(l.lineTotal ?? l.qtyReturn * l.price ?? 0),
            })),
          } : undefined,
        },
        include: { lines: true },
      });
    });

    return withCors(NextResponse.json(purchaseReturn, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create purchase return';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
