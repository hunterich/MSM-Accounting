import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const sr = await prisma.salesReturn.findFirst({
      where: { id, organizationId: orgId },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        invoice: { select: { id: true, number: true, lines: true } },
        lines: { include: { item: { select: { id: true, name: true } } } },
      },
    });
    if (!sr) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(sr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();
    const { lines, ...header } = body;

    const sr = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.salesReturnLine.deleteMany({ where: { salesReturnId: id } });
      }

      return tx.salesReturn.update({
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
              create: lines.map((l: { itemId?: string; itemName?: string; description?: string; qtySold?: number; qtyReturn?: number; unit?: string; price?: number; lineTotal?: number }, idx: number) => ({
                lineNo:    idx + 1,
                itemId:    l.itemId || null,
                itemName:  l.itemName || l.description || '',
                qtySold:   Number(l.qtySold ?? 0),
                qtyReturn: Number(l.qtyReturn ?? 0),
                unit:      l.unit || 'PCS',
                price:     Number(l.price ?? 0),
                lineTotal: Number(l.lineTotal ?? 0),
              })),
            },
          } : {}),
        },
        include: { lines: true },
      });
    });

    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(sr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.salesReturnLine.deleteMany({ where: { salesReturnId: id } });
      await tx.salesReturn.delete({ where: { id, organizationId: orgId } });
    });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'SalesReturn', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
