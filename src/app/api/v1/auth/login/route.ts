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
          take: 1,
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
    return withCors(NextResponse.json({ error: 'Login failed' }, { status: 500 }));
  }
}
