import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, signToken, COOKIE_NAME } from '@/lib/auth';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const memberships = await prisma.userOrganization.findMany({
      // Active membership AND active user account — a deactivated user must not
      // keep extending their session via refresh.
      where: { userId: payload.userId, isActive: true, user: { status: 'ACTIVE' } },
      orderBy: [{ joinedAt: 'asc' as const }, { id: 'asc' as const }],
      include: {
        role: { select: { roleType: true } },
        organization: { select: { displayName: true } },
      },
    });
    if (memberships.length === 0) {
      return withCors(NextResponse.json({ error: 'No organization found for user' }, { status: 403 }));
    }

    const fresh = await signToken({
      userId: payload.userId,
      email: payload.email,
      memberships: memberships.map((m) => ({ orgId: m.organizationId, roleType: m.role.roleType })),
    });

    const response = NextResponse.json({
      memberships: memberships.map((m) => ({
        orgId: m.organizationId,
        name: m.organization.displayName,
        roleType: m.role.roleType,
      })),
    });

    // Same cookie options as login/route.ts.
    response.cookies.set(COOKIE_NAME, fresh, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    return withCors(response);
  } catch {
    return withCors(NextResponse.json({ error: 'Refresh failed' }, { status: 500 }));
  }
}
