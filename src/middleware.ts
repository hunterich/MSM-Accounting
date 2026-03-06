import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '../lib/auth';
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

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', payload.userId);
  requestHeaders.set('x-org-id', payload.orgId);
  requestHeaders.set('x-role-type', payload.roleType);

  return withCors(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: ['/api/v1/:path*'],
};
