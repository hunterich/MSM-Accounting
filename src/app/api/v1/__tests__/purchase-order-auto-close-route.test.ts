import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const tx = {
  $executeRaw: vi.fn(),
  organization: { findUnique: vi.fn() },
  purchaseOrder: { findFirst: vi.fn(), update: vi.fn() },
  purchaseOrderLine: { deleteMany: vi.fn(), createMany: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(async (fn) => fn(tx)) } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/api-utils', async (orig) => ({ ...(await orig<any>()), logAudit: vi.fn() }));
import { PUT } from '../purchase-orders/[id]/route';

const existing = { id: 'po-1', status: 'APPROVED', autoCloseEnabled: true, autoCloseDays: 30, lines: [] };
function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/purchase-orders/po-1', { method: 'PUT',
    headers: { 'x-org-id': 'org-1', 'x-user-id': 'user-1', 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  tx.organization.findUnique.mockResolvedValue({ purchasePolicy: { autoCloseEnabled: true, autoCloseDays: 30, allowAutoCloseOverride: true } });
  tx.purchaseOrder.findFirst.mockResolvedValue(existing);
});
const call = (body: unknown) => PUT(request(body), { params: Promise.resolve({ id: 'po-1' }) });

describe('per-order auto-close editing', () => {
  it('persists the override and can clear the expected date without replacing lines', async () => {
    expect((await call({ autoCloseEnabled: false, autoCloseDays: 60, expectedDate: null })).status).toBe(200);
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'po-1', organizationId: 'org-1' },
      data: expect.objectContaining({ autoCloseEnabled: false, autoCloseDays: 60, expectedDate: null }),
    }));
    expect(tx.purchaseOrderLine.deleteMany).not.toHaveBeenCalled();
  });
  it('enforces company override restrictions at the API', async () => {
    tx.organization.findUnique.mockResolvedValue({ purchasePolicy: { allowAutoCloseOverride: false } });
    expect((await call({ autoCloseDays: 90 })).status).toBe(422);
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
  });
  it('allows metadata changes on a partially received PO without altering receipts', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({ ...existing, status: 'PARTIAL_RECEIVED', lines: [{ itemId: 'item-1', receivedQty: 1 }] });
    expect((await call({ autoCloseDays: 60 })).status).toBe(200);
    expect(tx.purchaseOrderLine.deleteMany).not.toHaveBeenCalled();
    expect((await call({ status: 'DRAFT', lines: [] })).status).toBe(422);
  });
  it('prevents a closed PO from being reopened through a regular edit', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({ ...existing, status: 'CLOSED' });
    expect((await call({ status: 'APPROVED', autoCloseEnabled: false })).status).toBe(422);
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
  });
});
