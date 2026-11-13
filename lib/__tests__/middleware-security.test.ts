import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('schedule enforcement at request admission', () => {
  const staff = (timezone = 'Asia/Jakarta') => ({
    ...activeUser(), memberships: [{
      organizationId: 'o1', organization: { timezone },
      role: { roleType: 'CUSTOM', allowedDays: ['Mon'], startTime: '08:00', endTime: '17:00' },
    }],
  });
  afterEach(() => vi.useRealTimers());
  it.each(['/api/v1/invoices', '/api/v1/customers', '/api/v1/approvals/a1/approve', '/api/v1/integrations/shop/import'])('denies %s outside hours even with stale ADMIN token', async path => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    findUnique.mockResolvedValue(staff());
    const response = await middleware(await request(path));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ACCESS_SCHEDULE_DENIED' });
  });
  it('allows a request before cutoff; a new request at cutoff is denied', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T09:59:59Z'));
    findUnique.mockResolvedValue(staff());
    const admitted = await middleware(await request('/api/v1/integrations/shop/import'));
    expect(admitted.headers.get('x-middleware-next')).toBe('1');
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    expect(admitted.headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(await request('/api/v1/integrations/shop/import'))).status).toBe(403);
  });
  it('uses live company timezone and role edits on the next request', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
    findUnique.mockResolvedValue(staff());
    expect((await middleware(await request())).headers.get('x-middleware-next')).toBe('1');
    findUnique.mockResolvedValue(staff('America/New_York'));
    expect((await middleware(await request())).status).toBe(403);
  });
  it('exposes only schedule metadata on its authenticated no-store probe outside hours', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    findUnique.mockResolvedValue(staff());
    const response = await middleware(await request('/api/v1/access-schedule'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ allowed: false, exempt: false, timezone: 'Asia/Jakarta' });
    expect((await middleware(new NextRequest('http://localhost/api/v1/access-schedule'))).status).toBe(401);
  });
  it('keeps password change and company selection available outside hours', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    findUnique.mockResolvedValue(staff());
    expect((await middleware(await request('/api/v1/users/me/password'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(await request('/api/v1/organizations'))).headers.get('x-middleware-next')).toBe('1');
  });
  it('an ADMIN remains exempt from schedule restrictions', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    const user = staff(); user.memberships[0].role.roleType = 'ADMIN';
    findUnique.mockResolvedValue(user);
    expect((await middleware(await request())).headers.get('x-middleware-next')).toBe('1');
  });
});
