import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';
import { computeSettlement } from '@/lib/document-settlement';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const num = (v: unknown): number => Number(v ?? 0);

// Payment / return position of one sales invoice (paid, returned, owing, history).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const invoice = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      select: { id: true, status: true, totalAmount: true },
    });
    if (!invoice) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    const [allocations, creditNotes] = await Promise.all([
      prisma.aRPaymentAllocation.findMany({
        where: { invoiceId: invoice.id, payment: { organizationId: orgId, status: 'COMPLETED' } },
        select: {
          amountApplied: true,
          discountAmount: true,
          payment: { select: { id: true, number: true, date: true } },
        },
      }),
      // Only notes applied against the invoice reduce what is owed; a refunded
      // note has already gone back out as cash.
      prisma.creditNote.findMany({
        where: {
          organizationId: orgId,
          sourceInvoiceId: invoice.id,
          status: 'APPLIED',
          settlementType: 'APPLY_TO_INVOICE',
        },
        select: { id: true, number: true, date: true, amount: true, taxAmount: true },
      }),
    ]);

    return withCors(NextResponse.json(computeSettlement({
      total: num(invoice.totalAmount),
      status: invoice.status,
      payments: allocations.map((a) => ({
        id: a.payment.id,
        number: a.payment.number,
        date: a.payment.date,
        amount: num(a.amountApplied) + num(a.discountAmount),
      })),
      returns: creditNotes.map((c) => ({ id: c.id, number: c.number, date: c.date, amount: num(c.amount) })),
    })));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
