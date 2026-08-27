import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken, COOKIE_NAME } from '@/lib/auth';
import { comparePassword } from '@/lib/password';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Signed-in-but-companyless session: identity only, no org and no role. The
 * client shows the company picker (create-first-company path) on this shape.
 */
async function emptySessionResponse(user: { id: string; email: string; fullName: string; mustChangePassword: boolean }) {
  const token = await signToken({ userId: user.id, email: user.email, memberships: [] });
  const response = NextResponse.json({
    user: { id: user.id, email: user.email, fullName: user.fullName },
    org: null,
    memberships: [],
    needsOrgSelection: true,
    mustChangePassword: user.mustChangePassword === true,
  });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',
  });
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return withCors(NextResponse.json({ error: 'Invalid input' }, { status: 400 }));
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
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

    if (!user || !user.passwordHash) {
      return withCors(NextResponse.json({ error: 'Invalid email or password' }, { status: 401 }));
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return withCors(NextResponse.json({ error: 'Invalid email or password' }, { status: 401 }));
    }

    const memberships = user.memberships; // all active

    // No company yet: sign the user in with an empty membership list and hand
    // them to the company picker, which offers to create their first one.
    // `resolveActiveOrg` still fails closed on that token, so every
    // tenant-scoped route stays shut until a company exists and is selected.
    if (memberships.length === 0) {
      if (user.status !== 'ACTIVE') {
        return withCors(NextResponse.json({ error: 'Account is not active' }, { status: 403 }));
      }
      return withCors(await emptySessionResponse(user));
    }

    // Keep today's response shape computed from the FIRST membership so
    // single-org clients behave identically.
    const membership = memberships[0];
    const organization = membership.organization as typeof membership.organization & {
      costingMethod: string | null;
      costingMethodEffectiveDate: Date | null;
    };

    const token = await signToken({
      userId: user.id,
      email: user.email,
      memberships: memberships.map((m) => ({ orgId: m.organizationId, roleType: m.role.roleType })),
    });

    const response = NextResponse.json({
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
      memberships: memberships.map((m) => ({
        orgId: m.organizationId,
        name: m.organization.displayName,
        roleType: m.role.roleType,
      })),
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    return withCors(response);
  } catch {
    return withCors(NextResponse.json({ error: 'Login failed' }, { status: 500 }));
  }
}
