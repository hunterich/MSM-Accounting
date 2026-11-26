import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { credentialStamp, signToken } from '@/lib/auth';

const { findUnique, findMany } = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique }, userOrganization: { findMany } } }));
import { GET as me } from '../auth/me/route';
import { POST as refresh } from '../auth/refresh/route';

beforeEach(() => {
  process.env.JWT_SECRET = 'session-revocation-test-secret';
  vi.clearAllMocks();
});

async function request(path: string) {
  const token = await signToken({
    userId: 'u1', email: 'u@example.test', credentialStamp: credentialStamp('old-hash'),
    memberships: [{ orgId: 'org-a', roleType: 'ADMIN' }],
  });
  return new NextRequest(`http://localhost/api/v1/auth/${path}`, {
    method: path === 'refresh' ? 'POST' : 'GET', headers: { cookie: `msm_token=${token}` },
  });
}

describe('password change revokes authentication endpoints', () => {
  it('rejects an old cookie on session inspection', async () => {
    findUnique.mockResolvedValue({ status: 'ACTIVE', passwordHash: 'new-hash', memberships: [] });
    expect((await me(await request('me'))).status).toBe(401);
  });
  it('cannot refresh an old cookie into a new session', async () => {
    findUnique.mockResolvedValue({ status: 'ACTIVE', passwordHash: 'new-hash' });
    expect((await refresh(await request('refresh'))).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });
});
