// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: id },
      include: { vendor: true, lines: true },
    });
    if (!bill) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(bill));
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
      await tx.bill.update({
        where: { id: id, organizationId: orgId },
        data: { ...header, updatedAt: new Date() },
      });
      if (lines) {
        await tx.billLine.deleteMany({ where: { billId: id } });
        await tx.billLine.createMany({
          data: lines.map((l: any, idx: number) => ({
            ...l,
            billId: id,
            lineNo: l.lineNo ?? idx + 1,
          })),
        });
      }
      return tx.bill.findUnique({
        where: { id: id },
        include: { vendor: true, lines: true },
      });
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'UPDATE', payload: body });
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
    await prisma.bill.delete({ where: { id: id, organizationId: orgId } });
    logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
