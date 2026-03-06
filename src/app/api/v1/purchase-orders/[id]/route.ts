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
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: id },
      include: { vendor: true, lines: true },
    });
    if (!po) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(po));
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
    const { lines, number, ...header } = body; // number is immutable

    const updated = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: id, organizationId: orgId },
        data: { ...header, updatedAt: new Date() },
      });
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((l: any, idx: number) => ({
            ...l,
            purchaseOrderId: id,
            lineNo: l.lineNo ?? idx + 1,
          })),
        });
      }
      return tx.purchaseOrder.findUnique({
        where: { id: id },
        include: { vendor: true, lines: true },
      });
    });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    await prisma.purchaseOrder.delete({ where: { id: id, organizationId: orgId } });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
