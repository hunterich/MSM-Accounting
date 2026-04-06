// @ts-nocheck
// Customer model: code (required), name, email, phone, status (PartnerStatus: ACTIVE|INACTIVE)
// Unique: @@unique([organizationId, code])
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, listResponse, logAudit, ok, parsePaginationParams, withHandler } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');
  const status = searchParams.get('status'); // ACTIVE | INACTIVE

  const where: any = { organizationId: orgId };
  where.status = status || 'ACTIVE';
  if (search) where.OR = [
    { name:  { contains: search, mode: 'insensitive' } },
    { code:  { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];

  const [data, total] = await Promise.all([
    prisma.customer.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.customer.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const body = await req.json();
  const customer = await prisma.customer.create({
    data: { ...body, organizationId: orgId },
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Customer', entityId: customer.id, action: 'CREATE', payload: null });
  return ok(customer, 201);
});
