// @ts-nocheck
// Bill model: number, vendorId, issueDate, dueDate, status (BillStatus), totalAmount
// BillStatus: DRAFT | OPEN | PENDING | PAID | OVERDUE | VOID
// BillLine fields: billId, lineNo, description, quantity, unit, price, lineTotal
// Unique: @@unique([organizationId, number])
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { nextNumber } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, Number(searchParams.get('page')  ?? 1));
    const limit  = Math.min(100, Number(searchParams.get('limit') ?? 20));
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const where: any = { organizationId: orgId };
    if (status) where.status = status;
    if (search) where.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
    ];

    const [data, total] = await Promise.all([
      prisma.bill.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { issueDate: 'desc' },
        include: { vendor: { select: { id: true, name: true, code: true } }, lines: true },
      }),
      prisma.bill.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list bills';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const body = await req.json();
    const { lines, ...header } = body;
    const number = await nextNumber(prisma, 'Bill', 'number', 'BILL');

    const bill = await prisma.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: { ...header, organizationId: orgId, number },
      });
      if (lines && lines.length > 0) {
        await tx.billLine.createMany({
          data: lines.map((l: any, idx: number) => ({
            ...l,
            billId: created.id,
            lineNo: l.lineNo ?? idx + 1,
          })),
        });
      }
      return tx.bill.findUnique({
        where: { id: created.id },
        include: { vendor: true, lines: true },
      });
    });

    return withCors(NextResponse.json(bill, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create bill';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
