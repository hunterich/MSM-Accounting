import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return withCors(NextResponse.json({ error: 'Invalid token' }, { status: 401 }));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        memberships: {
          where: {
            organizationId: payload.orgId,
            isActive: true,
          },
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
            organization: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      return withCors(NextResponse.json({ error: 'User not found' }, { status: 404 }));
    }

    const membership = user.memberships[0];
    if (!membership) {
      return withCors(NextResponse.json({ error: 'Membership not found' }, { status: 403 }));
    }

    return withCors(
      NextResponse.json({
        user: { id: user.id, email: user.email, fullName: user.fullName },
        org: { id: membership.organization.id, name: membership.organization.displayName },
        role: { type: membership.role.roleType, permissions: membership.role.permissions },
      })
    );
  } catch {
    return withCors(NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 }));
  }
}
