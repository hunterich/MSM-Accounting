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
    const data = await prisma.warehouse.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    });
    return withCors(NextResponse.json(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list warehouses';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
