import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { computeSettlement } from '@/lib/document-settlement';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const num = (v: unknown): number => Number(v ?? 0);

// Payment / return position of one purchase bill (paid, returned, owing, history).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  try {
    // Like the bill GET, the display id can be the bill number as well as the cuid.
    const bill = await prisma.bill.findFirst({
      where: { organizationId: orgId, OR: [{ id }, { number: id }] },
      select: { id: true, status: true, totalAmount: true },
    });
    if (!bill) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    const [allocations, debitNotes] = await Promise.all([
      prisma.aPPaymentAllocation.findMany({
        where: { billId: bill.id, payment: { organizationId: orgId, status: 'COMPLETED' } },
        select: {
          amountApplied: true,
          discountAmount: true,
          payment: { select: { id: true, number: true, date: true } },
        },
      }),
      prisma.debitNote.findMany({
        where: {
          organizationId: orgId,
          sourceBillId: bill.id,
          status: 'APPLIED',
          settlementType: 'APPLY_TO_BILL',
        },
        select: { id: true, number: true, date: true, amount: true, taxAmount: true },
      }),
    ]);

    return withCors(NextResponse.json(computeSettlement({
      total: num(bill.totalAmount),
      status: bill.status,
      payments: allocations.map((a) => ({
        id: a.payment.id,
        number: a.payment.number,
        date: a.payment.date,
        amount: num(a.amountApplied) + num(a.discountAmount),
      })),
      returns: debitNotes.map((d) => ({ id: d.id, number: d.number, date: d.date, amount: num(d.amount) + num(d.taxAmount) })),
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
