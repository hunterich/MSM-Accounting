import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// requirePermission (via withPermission) looks up the caller's role here.
vi.mock('@/lib/prisma', () => ({
  prisma: { userOrganization: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));
// Side effects that MUST NOT run when authorization fails.
vi.mock('@/lib/payroll-posting', () => ({ postPayrollRunToLedger: vi.fn() }));
vi.mock('@/lib/approval/engine', () => ({ routeForApproval: vi.fn() }));

import { POST as postPayroll } from '../payroll-runs/[id]/post/route';
import { prisma } from '@/lib/prisma';
import { postPayrollRunToLedger } from '@/lib/payroll-posting';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function makeReq(role: string) {
  return new NextRequest('http://localhost/api/v1/payroll-runs/p1/post', {
    method: 'POST',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u3', 'x-role-type': role },
  });
}

describe('authorization enforcement — payroll posting (audit finding #1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks a non-admin without HR_PAYROLL.create from posting payroll (403)', async () => {
    // role lookup grants nothing
    (prisma.userOrganization.findFirst as any).mockResolvedValue({
      role: { permissions: [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false }] },
    });
    const res = await postPayroll(makeReq('CUSTOM'), ctx('p1'));
    expect(res.status).toBe(403);
    // critical: the GL-posting side effect never ran
    expect(postPayrollRunToLedger).not.toHaveBeenCalled();
  });

  it('blocks a non-admin with no membership row at all (fail-closed 403)', async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValue(null);
    const res = await postPayroll(makeReq('VIEWER'), ctx('p1'));
    expect(res.status).toBe(403);
    expect(postPayrollRunToLedger).not.toHaveBeenCalled();
  });
});
