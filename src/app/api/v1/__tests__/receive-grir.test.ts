import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { purchaseOrder: { findFirst: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/api-utils', async (orig) => ({ ...(await orig<any>()), nextNumber: vi.fn(async () => 'BILL-0001') }));
vi.mock('@/lib/inventory-costing', () => ({ addCostLayer: vi.fn(async () => undefined) }));
vi.mock('@/lib/journal-posting', () => ({ postJournalEntry: vi.fn(async () => ({ id: 'je-1' })) }));
vi.mock('@/lib/grir', () => ({ ensureGrIrAccount: vi.fn(async () => 'acc-grir') }));
vi.mock('@/lib/account-defaults', async (orig) => ({ ...(await orig<any>()), loadOrgAccountDefaults: vi.fn(async () => ({})) }));

import { prisma } from '@/lib/prisma';
import { addCostLayer } from '@/lib/inventory-costing';
import { postJournalEntry } from '@/lib/journal-posting';
import { POST as receive } from '../purchase-orders/[id]/receive/route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/purchase-orders/po-1/receive', {
    method: 'POST',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

it('posts Dr Inventory / Cr GR/IR at net cost and a cost layer for an inventory line', async () => {
  vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
    id: 'po-1', number: 'PO-0001', vendorId: 'v-1', organizationId: 'org-a',
    status: 'APPROVED', taxRate: 0, taxable: false, taxInclusive: false,
    vendor: { id: 'v-1' },
    lines: [{ id: 'pol-1', quantity: 10, receivedQty: 0, price: 1000, itemId: 'item-1', description: 'Widget', unit: 'PCS' }],
  } as any);

  const tx = {
    $executeRaw: vi.fn(async () => undefined),
    purchaseOrderLine: { findUnique: vi.fn(async () => ({ id: 'pol-1', quantity: 10, receivedQty: 0, purchaseOrderId: 'po-1', description: 'Widget', price: 1000, unit: 'PCS', itemId: 'item-1' })), update: vi.fn(), findMany: vi.fn(async () => [{ quantity: 10, receivedQty: 10 }]) },
    bill: { create: vi.fn(async () => ({ id: 'bill-1', number: 'BILL-0001' })) },
    purchaseOrder: { update: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) },
    account: { findMany: vi.fn(async () => [{ id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true }]) },
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO', accountDefaults: null })) },
    accountingPeriod: { findFirst: vi.fn(async () => null) },
  };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await receive(req({ lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 10 }] }), { params: Promise.resolve({ id: 'po-1' }) });
  expect(res.status).toBe(201);
  expect(addCostLayer).toHaveBeenCalledTimes(1);
  expect((addCostLayer as any).mock.calls[0][5]).toBe(1000); // net unit cost (index: tx,orgId,itemId,warehouseId,qty,unitCost)
  const je = (postJournalEntry as any).mock.calls[0][1];
  expect(je.lines.find((l: any) => l.accountId === 'acc-grir').credit).toBe(10000);
});

it('refuses to receive into a closed/locked period and posts nothing', async () => {
  vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
    id: 'po-1', number: 'PO-0001', vendorId: 'v-1', organizationId: 'org-a',
    status: 'APPROVED', taxRate: 0, taxable: false, taxInclusive: false,
    vendor: { id: 'v-1' },
    lines: [{ id: 'pol-1', quantity: 10, receivedQty: 0, price: 1000, itemId: 'item-1', description: 'Widget', unit: 'PCS' }],
  } as any);

  const tx = {
    $executeRaw: vi.fn(async () => undefined),
    purchaseOrderLine: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    bill: { create: vi.fn() },
    purchaseOrder: { update: vi.fn() },
    item: { findMany: vi.fn() },
    account: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    accountingPeriod: { findFirst: vi.fn(async () => ({ name: 'Mar 2026', status: 'OPEN', isLocked: true })) },
  };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await receive(req({ lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 10 }] }), { params: Promise.resolve({ id: 'po-1' }) });
  expect(res.status).toBe(422);
  expect(addCostLayer).not.toHaveBeenCalled();
  expect(postJournalEntry).not.toHaveBeenCalled();
  expect(tx.bill.create).not.toHaveBeenCalled();
});

it('values a discounted PO line at its net (post-discount) cost', async () => {
  vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
    id: 'po-1', number: 'PO-0001', vendorId: 'v-1', organizationId: 'org-a',
    status: 'APPROVED', taxRate: 0, taxable: false, taxInclusive: false,
    vendor: { id: 'v-1' },
    lines: [{ id: 'pol-1', quantity: 10, receivedQty: 0, price: 1000, discountPct: 10, itemId: 'item-1', description: 'Widget', unit: 'PCS' }],
  } as any);

  const tx = {
    $executeRaw: vi.fn(async () => undefined),
    purchaseOrderLine: { findUnique: vi.fn(async () => ({ id: 'pol-1', quantity: 10, receivedQty: 0, purchaseOrderId: 'po-1', description: 'Widget', price: 1000, discountPct: 10, unit: 'PCS', itemId: 'item-1' })), update: vi.fn(), findMany: vi.fn(async () => [{ quantity: 10, receivedQty: 10 }]) },
    bill: { create: vi.fn(async () => ({ id: 'bill-1', number: 'BILL-0001' })) },
    purchaseOrder: { update: vi.fn() },
    item: { findMany: vi.fn(async () => [{ id: 'item-1' }]) },
    account: { findMany: vi.fn(async () => [{ id: 'acc-inv', code: '131', name: 'Persediaan', type: 'Asset', isActive: true, isPostable: true }]) },
    organization: { findUnique: vi.fn(async () => ({ costingMethod: 'FIFO', accountDefaults: null })) },
    accountingPeriod: { findFirst: vi.fn(async () => null) },
  };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await receive(req({ lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 10 }] }), { params: Promise.resolve({ id: 'po-1' }) });
  expect(res.status).toBe(201);
  // 10 units × 1000 less 10% = 9000 net; unit cost 900.
  expect((addCostLayer as any).mock.calls[0][5]).toBe(900);
  const je = (postJournalEntry as any).mock.calls[0][1];
  expect(je.lines.find((l: any) => l.accountId === 'acc-grir').credit).toBe(9000);
});
