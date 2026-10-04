import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), verifyIdToken: vi.fn(), comparePassword: vi.fn(), signToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/password', () => ({ comparePassword: mocks.comparePassword }));
vi.mock('@/lib/auth', () => ({ signToken: mocks.signToken, COOKIE_NAME: 'msm_token', verifyToken: vi.fn(async () => ({ userId: 'u1', memberships: [{ orgId: 'o1', roleType: 'ADMIN' }] })), resolveActiveOrg: vi.fn(() => ({ ok: true, orgId: 'o1' })) }));
vi.mock('google-auth-library', () => ({ OAuth2Client: class { verifyIdToken = mocks.verifyIdToken; } }));
vi.stubEnv('GOOGLE_CLIENT_ID', 'security-test-client');
const { POST: passwordLogin } = await import('../auth/login/route');
const { POST: googleLogin } = await import('../auth/google/route');
const { GET: session } = await import('../auth/me/route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.comparePassword.mockResolvedValue(true);
  mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'inactive@example.test', email_verified: true }) });
  mocks.findUnique.mockResolvedValue({ id: 'u1', email: 'inactive@example.test', status: 'INACTIVE', passwordHash: 'hash', memberships: [{ organizationId: 'o1' }] });
});
describe('inactive account with an active company membership', () => {
  it('cannot sign in using a correct password', async () => {
    const res = await passwordLogin(new NextRequest('http://localhost/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'inactive@example.test', password: 'correct123' }) }));
    expect(res.status).toBe(403);
    expect(res.cookies.get('msm_token')).toBeUndefined();
    expect(mocks.signToken).not.toHaveBeenCalled();
  });
  it('cannot sign in using a verified Google account', async () => {
    const res = await googleLogin(new NextRequest('http://localhost/api/v1/auth/google', { method: 'POST', body: JSON.stringify({ credential: 'valid-google-credential' }) }));
    expect(res.status).toBe(403);
    expect(res.cookies.get('msm_token')).toBeUndefined();
    expect(mocks.signToken).not.toHaveBeenCalled();
  });
  it('cannot obtain an active session response using an existing token', async () => {
    const res = await session(new NextRequest('http://localhost/api/v1/auth/me', { headers: { cookie: 'msm_token=existing-token' } }));
    expect(res.status).toBe(403);
  });
});
