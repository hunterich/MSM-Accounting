import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const tx = { tag: 'tx' };
vi.mock('@/lib/prisma', () => ({
  prisma: { userOrganization: { findFirst: vi.fn() }, $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) },
}));
vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));
vi.mock('@/lib/purchase-order-auto-close', () => ({ reopenPurchaseOrder: vi.fn() }));

import { POST as reopen } from '../purchase-orders/[id]/reopen/route';
import { prisma } from '@/lib/prisma';
import { reopenPurchaseOrder } from '@/lib/purchase-order-auto-close';
import { ApiError } from '@/lib/errors';

const ctx = { params: Promise.resolve({ id: 'po-1' }) };
function makeReq(role: string) {
  return new NextRequest('http://localhost/api/v1/purchase-orders/po-1/reopen', {
    method: 'POST',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'user-1', 'x-role-type': role },
  });
}
const grant = (perm: Partial<Record<'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canApprove', boolean>>) =>
  (prisma.userOrganization.findFirst as any).mockResolvedValue({
    role: { permissions: [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false, ...perm }] },
  });

describe('POST /purchase-orders/[id]/reopen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses staff who can create and edit POs but not approve them (403, nothing reopened)', async () => {
    grant({ canCreate: true, canEdit: true });
    const res = await reopen(makeReq('CUSTOM'), ctx);
    expect(res.status).toBe(403);
    expect(prisma.userOrganization.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: { role: { select: { permissions: expect.objectContaining({ where: { moduleKey: 'AP_POS' } }) } } },
    }));
    expect(reopenPurchaseOrder).not.toHaveBeenCalled();
  });

  it('lets a PO approver reopen, scoped to their company and recorded against them', async () => {
    grant({ canApprove: true });
    (reopenPurchaseOrder as any).mockResolvedValue({ id: 'po-1', status: 'PARTIAL_RECEIVED' });
    const res = await reopen(makeReq('CUSTOM'), ctx);
    expect(res.status).toBe(200);
    expect(reopenPurchaseOrder).toHaveBeenCalledWith(tx, 'org-a', 'po-1', 'user-1');
    expect(await res.json()).toMatchObject({ status: 'PARTIAL_RECEIVED' });
  });

  it('passes through refusals from the reopen rules', async () => {
    (reopenPurchaseOrder as any).mockRejectedValue(new ApiError('Only a closed purchase order can be reopened', 422));
    const res = await reopen(makeReq('ADMIN'), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/closed purchase order/);
  });
});
