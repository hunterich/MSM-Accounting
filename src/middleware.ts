import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, resolveActiveOrg, isOrgOptionalPath, COOKIE_NAME } from '../lib/auth';
import { CORS_HEADERS } from '../lib/cors';
import { prisma } from '../lib/prisma';
import { accessScheduleStatus } from '../lib/access-schedule';

const AUTH_PATHS = new Set([
  '/api/v1/auth/login', '/api/v1/auth/google', '/api/v1/auth/me',
  '/api/v1/auth/refresh', '/api/v1/auth/logout',
]);

const withCors = (response: NextResponse) => {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
};

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname.replace(/\/+$/, '');

  if (req.method === 'OPTIONS') {
    return withCors(new NextResponse(null, { status: 204 }));
  }

  if (AUTH_PATHS.has(pathname)) {
    return withCors(NextResponse.next());
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return withCors(NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }));
  }

  // Tokens identify the user; current database state decides access. Never let
  // an old ADMIN claim survive membership removal or a role downgrade.
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      status: true,
      mustChangePassword: true,
      memberships: {
        where: { isActive: true },
        select: {
          organizationId: true,
          organization: { select: { timezone: true } },
          role: { select: { roleType: true, allowedDays: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (!user || user.status !== 'ACTIVE') {
    return withCors(NextResponse.json({ error: 'Account is not active' }, { status: 403 }));
  }
  if (user.mustChangePassword && pathname !== '/api/v1/users/me/password') {
    return withCors(NextResponse.json({ error: 'Change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' }, { status: 403 }));
  }
  const resolution = resolveActiveOrg({
    ...payload,
    memberships: user.memberships.map((m) => ({ orgId: m.organizationId, roleType: m.role.roleType })),
  }, req.headers.get('x-active-org'));
  if (!resolution.ok && !isOrgOptionalPath(pathname)) {
    return withCors(NextResponse.json(
      { error: resolution.error, code: resolution.code },
      { status: resolution.status },
    ));
  }

  // Authorize once at request admission. An accepted import/save may finish
  // after closing time; never recheck the wall clock inside its transaction.
  // Self-service and the status probe stay reachable without granting data access.
  if (resolution.ok && !isOrgOptionalPath(pathname) && pathname !== '/api/v1/users/me/password') {
    const membership = user.memberships.find(m => m.organizationId === resolution.orgId)!;
    const status = accessScheduleStatus(membership.role, membership.organization?.timezone ?? '', new Date());
    if (pathname === '/api/v1/access-schedule' && req.method === 'GET') {
      const response = withCors(NextResponse.json(status));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if (!status.allowed) {
      return withCors(NextResponse.json({
        error: 'Outside your role’s access hours. Your unfinished work can be resumed during allowed hours.',
        code: 'ACCESS_SCHEDULE_DENIED',
      }, { status: 403 }));
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', payload.userId);   // always overwrite — never trust client values
  if (resolution.ok) {
    requestHeaders.set('x-org-id', resolution.orgId);
    requestHeaders.set('x-role-type', resolution.roleType);
  } else {
    // Org-optional path with no resolvable org: the tenant headers must be
    // ABSENT, not client-controlled. Deleting them is what makes requireAuth /
    // requireOrg fail closed if such a route ever touches tenant data.
    requestHeaders.delete('x-org-id');
    requestHeaders.delete('x-role-type');
  }

  return withCors(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/api/v1/:path*'],
};
