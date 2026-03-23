// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const orgId = req.headers.get('x-org-id');
    const { searchParams } = new URL(req.url);
    const page       = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit      = Math.min(100, Number(searchParams.get('limit') ?? 50));
    const entityType = searchParams.get('entityType');
    const entityId   = searchParams.get('entityId');
    const action     = searchParams.get('action');

    const where: any = { organizationId: orgId };
    if (entityType) where.entityType = entityType;
    if (entityId)   where.entityId = entityId;
    if (action)     where.action = action;

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return withCors(NextResponse.json({ data, total, page, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list audit logs';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
