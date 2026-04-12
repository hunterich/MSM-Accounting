import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { updateBillInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const bill = await prisma.bill.findFirst({
      where: { id, organizationId: orgId },
      include: { vendor: true, lines: true, attachments: true },
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
  const orgId = req.headers.get('x-org-id')!;
  try {
    const body = await req.json();
    const parsed = updateBillInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid bill payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { lines, ...header } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.bill.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true } });
      if (!existing) return null;
      if (existing.status !== 'DRAFT') {
        throw new ApiError('Only DRAFT bills can be modified', 403);
      }
      if (header.vendorId) {
        await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
      }
      if (header.poId) {
        await validateForeignKey(tx.purchaseOrder, { id: header.poId, organizationId: orgId }, 'Purchase order not found in organization');
      }
      await tx.bill.update({
        where: { id, organizationId: orgId },
        data: { ...header, updatedAt: new Date() },
      });
      if (lines) {
        await tx.billLine.deleteMany({ where: { billId: id } });
        await tx.billLine.createMany({
          data: lines.map((l, idx: number) => ({
            billId: id,
            itemId: l.itemId || null,
            accountId: l.accountId || null,
            lineNo: l.lineNo ?? idx + 1,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            price: l.price,
            lineTotal: l.lineTotal ?? (Number(l.quantity) * Number(l.price)),
          })),
        });
      }
      return tx.bill.findFirst({
        where: { id, organizationId: orgId },
        include: { vendor: true, lines: true, attachments: true },
      });
    });
    if (!updated) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const existing = await prisma.bill.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true } });
    if (!existing) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }
    if (existing.status !== 'DRAFT') {
      return withCors(NextResponse.json({ error: 'Only DRAFT bills can be deleted' }, { status: 403 }));
    }
    await prisma.bill.update({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
