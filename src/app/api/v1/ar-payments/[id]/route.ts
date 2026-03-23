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
    const payment = await prisma.aRPayment.findUnique({
      where: { id: id },
      include: { customer: true, allocations: true },
    });
    if (!payment) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(payment));
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
    // number is immutable — remove it from the update
    const { number, ...data } = body;
    const payment = await prisma.aRPayment.update({
      where: { id: id, organizationId: orgId },
      data: { ...data, updatedAt: new Date() },
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(payment));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    await prisma.aRPayment.delete({ where: { id: id, organizationId: orgId } });
    logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'ARPayment', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
