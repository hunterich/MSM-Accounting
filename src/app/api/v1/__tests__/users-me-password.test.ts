import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return {
    ...actual,
    hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
    comparePassword: vi.fn(),
  };
});
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return { ...actual, logAudit: vi.fn() };
});

import { POST } from '../users/me/password/route';
import { prisma } from '@/lib/prisma';
import { comparePassword } from '@/lib/password';
import { credentialStamp, signToken, verifyToken } from '@/lib/auth';

const headers = { 'x-org-id': 'org-a', 'x-user-id': 'u2', 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
const makeReq = (body: unknown, token = '') =>
  new NextRequest('http://localhost/api/v1/users/me/password', {
    method: 'POST', headers: { ...headers, cookie: `msm_token=${token}` }, body: JSON.stringify(body),
  });

describe('POST /api/v1/users/me/password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'password-test-secret';
    (prisma.$transaction as any).mockImplementation((fn: any) => fn(prisma));
    (prisma.user.updateMany as any).mockResolvedValue({ count: 1 });
  });

  it('changes the password and clears the must-change flag', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', passwordHash: 'old-hash' });
    (comparePassword as any).mockResolvedValue(true);
    const oldToken = await signToken({ userId: 'u2', email: 'u@example.test', memberships: [], credentialStamp: credentialStamp('old-hash') });
    const res = await POST(makeReq({ currentPassword: 'temp123ab', newPassword: 'fresh123' }, oldToken));
    expect(res.status).toBe(200);
    const call = (prisma.user.updateMany as any).mock.calls[0][0];
    expect(call.data.passwordHash).toBe('hashed:fresh123');
    expect(call.data.mustChangePassword).toBe(false);
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const fresh = await verifyToken(res.cookies.get('msm_token')!.value);
    expect(fresh?.credentialStamp).toBe(credentialStamp('hashed:fresh123'));
  });

  it('rejects a wrong current password with 400', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', passwordHash: 'old-hash' });
    (comparePassword as any).mockResolvedValue(false);
    const res = await POST(makeReq({ currentPassword: 'wrong123', newPassword: 'fresh123' }));
    expect(res.status).toBe(400);
    expect(prisma.user.updateMany as any).not.toHaveBeenCalled();
  });

  it('rejects a weak new password with 400', async () => {
    const res = await POST(makeReq({ currentPassword: 'temp123ab', newPassword: 'weak' }));
    expect(res.status).toBe(400);
  });
});
