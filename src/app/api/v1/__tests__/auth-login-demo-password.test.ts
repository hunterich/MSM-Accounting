import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), comparePassword: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock('@/lib/password', () => ({ comparePassword: mocks.comparePassword }));
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'msm_token',
  signToken: vi.fn(async () => 'signed-token'),
  credentialStamp: vi.fn(() => 'stamp'),
}));
const { POST: login } = await import('../auth/login/route');

// A fresh email per request keeps the in-memory login throttle out of the way.
let n = 0;
function signIn(password: string) {
  const email = `demo-${++n}@example.test`;
  mocks.findUnique.mockResolvedValue({
    id: 'u1', email, fullName: 'Demo', status: 'ACTIVE', passwordHash: 'hash',
    mustChangePassword: false, memberships: [],
  });
  return login(new NextRequest('http://localhost/api/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.comparePassword.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('sign-in with a published demo password (#236)', () => {
  it('forces a password change in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await signIn('admin123');
    expect(res.status).toBe(200);
    expect((await res.json()).mustChangePassword).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { mustChangePassword: true } });
  });

  it('leaves other passwords alone in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await signIn('Real-password9');
    expect((await res.json()).mustChangePassword).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not force a change in development or an opted-in demo install', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await (await signIn('admin123')).json()).mustChangePassword).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_DEMO_PASSWORDS', 'true');
    expect((await (await signIn('cashier123')).json()).mustChangePassword).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('never flags anything when the password is wrong', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.comparePassword.mockResolvedValue(false);
    expect((await signIn('admin123')).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
