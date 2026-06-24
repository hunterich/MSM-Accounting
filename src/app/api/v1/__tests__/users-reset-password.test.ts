import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrganization: { findFirst: vi.fn() },
    user: { update: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return { ...actual, hashPassword: vi.fn(async (p: string) => `hashed:${p}`) };
});
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return { ...actual, logAudit: vi.fn() };
});

import { POST } from '../users/[id]/reset-password/route';
import { prisma } from '@/lib/prisma';

const adminHeaders = {
  'x-role-type': 'ADMIN', 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json',
};
const makeReq = (id: string, body: unknown, headers = adminHeaders) =>
  new NextRequest(`http://localhost/api/v1/users/${id}/reset-password`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/v1/users/[id]/reset-password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets the password and forces change on next login', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue({ id: 'm1', userId: 'u2' });
    (prisma.user.update as any).mockResolvedValue({ id: 'u2' });
    const res = await POST(makeReq('u2', { newPassword: 'newpass123' }), ctx('u2'));
    expect(res.status).toBe(200);
    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u2' });
    expect(call.data.passwordHash).toBe('hashed:newpass123');
    expect(call.data.mustChangePassword).toBe(true);
  });

  it('rejects a non-admin with 403', async () => {
    const res = await POST(
      makeReq('u2', { newPassword: 'newpass123' }, { ...adminHeaders, 'x-role-type': 'CUSTOM' }),
      ctx('u2'),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the target user is not in the caller org', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue(null);
    const res = await POST(makeReq('u9', { newPassword: 'newpass123' }), ctx('u9'));
    expect(res.status).toBe(404);
    expect(prisma.user.update as any).not.toHaveBeenCalled();
  });

  it('rejects a weak password with 400', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue({ id: 'm1', userId: 'u2' });
    const res = await POST(makeReq('u2', { newPassword: 'short' }), ctx('u2'));
    expect(res.status).toBe(400);
    expect(prisma.user.update as any).not.toHaveBeenCalled();
  });
});
