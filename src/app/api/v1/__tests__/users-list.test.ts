import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrganization: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

import { GET } from '../users/route';
import { prisma } from '@/lib/prisma';

const adminHeaders = { 'x-role-type': 'ADMIN', 'x-org-id': 'org-a', 'x-user-id': 'u1' };

describe('GET /api/v1/users', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns org-scoped users for an admin', async () => {
    (prisma.userOrganization.findMany as any).mockResolvedValue([
      { user: { id: 'u2', fullName: 'Staff One', email: 's1@demo.com', status: 'ACTIVE' }, role: { name: 'Accounting Staff' } },
    ]);
    const req = new NextRequest('http://localhost/api/v1/users', { headers: adminHeaders });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { id: 'u2', fullName: 'Staff One', email: 's1@demo.com', status: 'ACTIVE', roleName: 'Accounting Staff' },
    ]);
    expect((prisma.userOrganization.findMany as any).mock.calls[0][0].where.organizationId).toBe('org-a');
  });

  it('rejects a non-admin with 403', async () => {
    const req = new NextRequest('http://localhost/api/v1/users', {
      headers: { 'x-role-type': 'CUSTOM', 'x-org-id': 'org-a', 'x-user-id': 'u3' },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
