import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken, COOKIE_NAME } from '@/lib/auth';
import { corsPreflightResponse, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

const schema = z.object({
  credential: z.string().min(1),
});

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const oauthClient = new OAuth2Client(googleClientId || undefined);

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
    if (!googleClientId) {
      return withCors(NextResponse.json({ error: 'Google OAuth is not configured' }, { status: 500 }));
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: 'Invalid input' }, { status: 400 }));
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken: parsed.data.credential,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;
    const emailVerified = payload?.email_verified;

    if (!email || !emailVerified) {
      return withCors(NextResponse.json({ error: 'Invalid Google account' }, { status: 401 }));
    }

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

    if (!user) {
      return withCors(
        NextResponse.json(
          { error: 'User is not provisioned. Ask admin to create your account first.' },
          { status: 403 },
        ),
      );
    }

    const memberships = user.memberships; // all active

    // No company yet — same as password login: identity-only session, the
    // client's company picker offers to create the first company.
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
    return withCors(NextResponse.json({ error: 'Google login failed' }, { status: 500 }));
  }
}
