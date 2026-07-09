import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, resolveActiveOrg, COOKIE_NAME } from '@/lib/auth';
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

    // This route bypasses middleware, so it resolves the active org itself.
    const resolution = resolveActiveOrg(payload, req.headers.get('x-active-org'));

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        memberships: {
          where: { isActive: true },
          orderBy: [{ joinedAt: 'asc' as const }, { id: 'asc' as const }],
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
            organization: true,
          },
        },
      },
    });

    if (!user) {
      return withCors(NextResponse.json({ error: 'User not found' }, { status: 404 }));
    }

    const membershipsOut = user.memberships.map((m) => ({
      orgId: m.organizationId,
      name: m.organization.displayName,
      roleType: m.role.roleType,
    }));

    if (!resolution.ok) {
      // No/invalid active org: return identity + memberships so the client can show the picker.
      return withCors(
        NextResponse.json({
          user: { id: user.id, email: user.email, fullName: user.fullName },
          memberships: membershipsOut,
          org: null,
          needsOrgSelection: true,
          mustChangePassword: user.mustChangePassword === true,
        })
      );
    }

    const membership = user.memberships.find((m) => m.organizationId === resolution.orgId);
    if (!membership) {
      return withCors(NextResponse.json({ error: 'Membership not found' }, { status: 403 }));
    }
    const organization = membership.organization as typeof membership.organization & {
      costingMethod: string | null;
      costingMethodEffectiveDate: Date | null;
    };

    return withCors(
      NextResponse.json({
        user: { id: user.id, email: user.email, fullName: user.fullName },
        org: {
          id: organization.id,
          name: organization.displayName,
          costingMethod: organization.costingMethod,
          costingMethodEffectiveDate: organization.costingMethodEffectiveDate,
        },
        needsInventoryValuationSetup: !organization.costingMethod,
        mustChangePassword: user.mustChangePassword === true,
        role: {
          type: membership.role.roleType,
          permissions: membership.role.permissions,
          invoiceAccessScope: membership.role.invoiceAccessScope,
        },
        memberships: membershipsOut,
      })
    );
  } catch {
    return withCors(NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 }));
  }
}
