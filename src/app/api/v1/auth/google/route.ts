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
          take: 1,
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

    const membership = user.memberships[0];
    if (!membership) {
      return withCors(NextResponse.json({ error: 'No organization found for user' }, { status: 403 }));
    }

    const token = await signToken({
      userId: user.id,
      orgId: membership.organizationId,
      email: user.email,
      roleType: membership.role.roleType,
    });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, fullName: user.fullName },
      org: { id: membership.organization.id, name: membership.organization.displayName },
      role: {
        type: membership.role.roleType,
        permissions: membership.role.permissions,
        invoiceAccessScope: membership.role.invoiceAccessScope,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    return withCors(response);
  } catch {
    return withCors(NextResponse.json({ error: 'Google login failed' }, { status: 500 }));
  }
}
