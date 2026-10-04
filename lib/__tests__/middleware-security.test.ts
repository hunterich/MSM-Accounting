import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signToken } from '../auth';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique } } }));
vi.mock('../prisma', () => ({ prisma: { user: { findUnique } } }));
import { middleware } from '../../src/middleware';

const activeUser = () => ({ status: 'ACTIVE', mustChangePassword: false, memberships: [{ organizationId: 'o1', role: { roleType: 'ADMIN' } }] });
async function request(path = '/api/v1/users', headers: Record<string, string> = {}) {
  const token = await signToken({ userId: 'u1', email: 'admin@example.test', memberships: [{ orgId: 'o1', roleType: 'ADMIN' }] });
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: `msm_token=${token}`, ...headers } });
}
beforeEach(() => {
  process.env.JWT_SECRET = 'middleware-security-tests-secret-value';
  findUnique.mockReset();
  findUnique.mockResolvedValue(activeUser());
});
describe('live session access', () => {
  it('blocks a removed admin with a still-valid signed token', async () => {
    findUnique.mockResolvedValue({ ...activeUser(), memberships: [] });
    const res = await middleware(await request('/api/v1/users', { 'x-active-org': 'o1' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ORG_MEMBERSHIP' });
  });
  it('overwrites stale admin and spoofed identity with current database values', async () => {
    findUnique.mockResolvedValue({ ...activeUser(), memberships: [{ organizationId: 'o1', role: { roleType: 'VIEWER' } }] });
    const res = await middleware(await request('/api/v1/users', { 'x-role-type': 'ADMIN', 'x-user-id': 'attacker', 'x-org-id': 'foreign' }));
    expect(res.headers.get('x-middleware-request-x-role-type')).toBe('VIEWER');
    expect(res.headers.get('x-middleware-request-x-user-id')).toBe('u1');
    expect(res.headers.get('x-middleware-request-x-org-id')).toBe('o1');
  });
  it('blocks inactive accounts even with active membership', async () => {
    findUnique.mockResolvedValue({ ...activeUser(), status: 'INACTIVE' });
    expect((await middleware(await request())).status).toBe(403);
  });
  it('blocks a deleted account', async () => {
    findUnique.mockResolvedValue(null);
    expect((await middleware(await request())).status).toBe(403);
  });
  it('requires password change for business APIs, allowing the password endpoint', async () => {
    findUnique.mockResolvedValue({ ...activeUser(), mustChangePassword: true });
    const res = await middleware(await request());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    expect((await middleware(await request('/api/v1/users/me/password'))).headers.get('x-middleware-next')).toBe('1');
  });
  it('keeps company creation available for active users without memberships', async () => {
    findUnique.mockResolvedValue({ ...activeUser(), memberships: [] });
    const res = await middleware(await request('/api/v1/organizations', { 'x-org-id': 'foreign', 'x-role-type': 'ADMIN' }));
    expect(res.headers.get('x-middleware-request-x-org-id')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-role-type')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-user-id')).toBe('u1');
  });
});
