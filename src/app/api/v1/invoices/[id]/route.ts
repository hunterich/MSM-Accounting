import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit } from '@/lib/api-utils';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { routeForApproval } from '@/lib/approval/engine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    const userId = _req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const invoice = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        lines: true,
      },
    });
    if (!invoice) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(invoice));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const body = await req.json();
    const { lines, ...header } = body;
    delete header.organizationId;
    delete header.createdById;

    // Voiding a posted invoice must reverse its journal entries and restore the
    // sold stock — that only happens through the dedicated endpoint. A bare
    // status flip here would leave the GL + inventory wrong (the bug this guards).
    // Checked before any DB work so a rejected void is a cheap 422.
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted invoice through POST /api/v1/invoices/:id/void' },
        { status: 422 },
      ));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        select: { id: true, status: true, number: true, issueDate: true, organizationId: true },
      });

      if (!existing) {
        throw new AccessError('Invoice not found', 404);
      }

      if (existing.status !== 'DRAFT' && !isStatusOnlyUpdate) {
        throw new AccessError('Only DRAFT invoices can be modified', 403);
      }

      await tx.salesInvoice.update({
        where: { id },
        data: { ...header, updatedAt: new Date() },
      });

      if (lines) {
        await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.salesInvoiceLine.createMany({
          data: lines.map((l: any, idx: number) => ({
            ...l,
            invoiceId: id,
            lineNo: l.lineNo ?? idx + 1,
          })),
        });
      }

      // Post AR + COGS journals when invoice transitions DRAFT → SENT,
      // unless the approval engine routes the finalize for approval first.
      // The AR-side post (DR AR / CR Sales / CR Tax) runs for every invoice;
      // the COGS post only runs when the org has a costing method and the
      // invoice has inventory lines.
      if (existing.status === 'DRAFT' && header.status === 'SENT') {
        const routed = await routeForApproval(tx, {
          orgId: existing.organizationId,
          userId,
          documentType: 'INVOICE',
          documentId: existing.id,
        });
        if (routed) {
          // HELD for approval: the header update above already stamped
          // status='SENT'; override it back to PENDING_APPROVAL and post NO GL.
          await tx.salesInvoice.update({
            where: { id: existing.id },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          // Not required / already approved: keep SENT and post the GL.
          await postInvoiceSend(tx, existing.organizationId, existing.id);
        }
      }

      return tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        include: {
          customer: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
          lines: true,
        },
      });
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof AccessError || error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    const userId = _req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const existing = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      select: { id: true, status: true },
    });

    if (!existing) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }

    if (existing.status !== 'DRAFT') {
      return withCors(NextResponse.json({ error: 'Only DRAFT invoices can be deleted' }, { status: 403 }));
    }

    await prisma.salesInvoice.update({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } });
    logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
