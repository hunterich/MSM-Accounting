// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const pr = await prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        bill: { select: { id: true, number: true, lines: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    });
    if (!pr) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(pr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const { lines, ...header } = body;

    const pr = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
      }

      return tx.purchaseReturn.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          ...(header.returnDate && { returnDate: new Date(header.returnDate) }),
          ...(header.subtotal != null    && { subtotal:    Number(header.subtotal) }),
          ...(header.taxAmount != null   && { taxAmount:   Number(header.taxAmount) }),
          ...(header.totalAmount != null && { totalAmount: Number(header.totalAmount) }),
          updatedAt: new Date(),
          ...(lines ? {
            lines: {
              create: lines.map((l: any, idx: number) => ({
                lineNo:       idx + 1,
                lineKey:      l.lineKey || null,
                itemId:       l.itemId || null,
                description:  l.description || '',
                qtyPurchased: Number(l.qtyPurchased ?? 0),
                qtyReturn:    Number(l.qtyReturn ?? 0),
                unit:         l.unit || 'PCS',
                price:        Number(l.price ?? 0),
                lineTotal:    Number(l.lineTotal ?? 0),
              })),
            },
          } : {}),
        },
        include: { lines: true },
      });
    });

    return withCors(NextResponse.json(pr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    await prisma.$transaction(async (tx) => {
      await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
      await tx.purchaseReturn.delete({ where: { id, organizationId: orgId } });
    });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
