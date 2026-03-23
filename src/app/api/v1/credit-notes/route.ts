// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { nextNumber, logAudit } from '@/lib/api-utils';

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
      prisma.creditNote.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { date: 'desc' },
        include: {
          customer: { select: { id: true, name: true, code: true } },
          salesReturn: { select: { id: true, number: true } },
          sourceInvoice: { select: { id: true, number: true } },
        },
      }),
      prisma.creditNote.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list credit notes';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();

    const creditNote = await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, 'CreditNote', 'number', 'CRN');
      return tx.creditNote.create({
        data: {
          ...body,
          number,
          organizationId: orgId,
          amount: Number(body.amount) || 0,
          date: new Date(body.date),
        },
      });
    });

    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'CreditNote', entityId: creditNote.id, action: 'CREATE', payload: { number: creditNote.number } });
    return withCors(NextResponse.json(creditNote, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create credit note';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
