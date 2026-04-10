// Bill model: number, vendorId, issueDate, dueDate, status (BillStatus), totalAmount
// BillStatus: DRAFT | OPEN | PENDING | PAID | OVERDUE | VOID
// BillLine fields: billId, lineNo, description, quantity, unit, price, lineTotal
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { billInputSchema } from '@/types/api';
import { createBillRecord } from '@/lib/bills';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
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
      include: { vendor: { select: { id: true, name: true, code: true } }, lines: true, attachments: true },
    }),
    prisma.bill.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = billInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid bill payload', 400);
  }

  const bill = await prisma.$transaction((tx: any) => createBillRecord(tx, orgId, parsed.data));

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Bill',
    entityId: bill!.id,
    action: 'CREATE',
    payload: { number: bill!.number },
  });
  return ok(bill, 201);
});
