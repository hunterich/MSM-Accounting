import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, resolveActiveOrg, isOrgOptionalPath, COOKIE_NAME } from '../lib/auth';
import { CORS_HEADERS } from '../lib/cors';

const withCors = (response: NextResponse) => {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (req.method === 'OPTIONS') {
    return withCors(new NextResponse(null, { status: 204 }));
  }

  if (pathname.startsWith('/api/v1/auth')) {
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

  const resolution = resolveActiveOrg(payload, req.headers.get('x-active-org'));
  if (!resolution.ok && !isOrgOptionalPath(pathname)) {
    return withCors(NextResponse.json(
      { error: resolution.error, code: resolution.code },
      { status: resolution.status },
    ));
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
  matcher: ['/api/v1/:path*'],
};
