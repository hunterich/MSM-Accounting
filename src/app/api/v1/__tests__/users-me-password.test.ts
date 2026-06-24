import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
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

const headers = { 'x-org-id': 'org-a', 'x-user-id': 'u2', 'content-type': 'application/json' };
const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/password', {
    method: 'POST', headers, body: JSON.stringify(body),
  });

describe('POST /api/v1/users/me/password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('changes the password and clears the must-change flag', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', passwordHash: 'old-hash' });
    (comparePassword as any).mockResolvedValue(true);
    (prisma.user.update as any).mockResolvedValue({ id: 'u2' });
    const res = await POST(makeReq({ currentPassword: 'temp123ab', newPassword: 'fresh123' }));
    expect(res.status).toBe(200);
    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.data.passwordHash).toBe('hashed:fresh123');
    expect(call.data.mustChangePassword).toBe(false);
  });

  it('rejects a wrong current password with 400', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', passwordHash: 'old-hash' });
    (comparePassword as any).mockResolvedValue(false);
    const res = await POST(makeReq({ currentPassword: 'wrong123', newPassword: 'fresh123' }));
    expect(res.status).toBe(400);
    expect(prisma.user.update as any).not.toHaveBeenCalled();
  });

  it('rejects a weak new password with 400', async () => {
    const res = await POST(makeReq({ currentPassword: 'temp123ab', newPassword: 'weak' }));
    expect(res.status).toBe(400);
  });
});
