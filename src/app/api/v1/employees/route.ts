// @ts-nocheck
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, listResponse, nextNumber, logAudit, parsePaginationParams } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const search = searchParams.get('search');
  const status = searchParams.get('status');
  const where: any = { organizationId: orgId, status: status || 'ACTIVE' };
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { employeeNo: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const body = await req.json();
  const employeeNo = await nextNumber(prisma, 'Employee', 'employeeNo', 'EMP');
  const employee = await prisma.employee.create({
    data: { ...body, organizationId: orgId, employeeNo },
  });
  logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'Employee', entityId: employee.id, action: 'CREATE', payload: { name: employee.name, employeeNo: employee.employeeNo } });
  return ok(employee, 201);
}
