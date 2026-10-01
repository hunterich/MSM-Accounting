import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => ({})) } } }));
import { prisma } from '@/lib/prisma';
import { POST } from '../assets/[id]/activate/route';

function fixture(over = {}) {
  const asset = { id: 'asset', status: 'DRAFT', assetNo: 'ASSET-1', acquisitionDate: new Date('2026-09-01'),
    category: { depExpenseAccountId: 'dep', accumDepAccountId: 'accum' },
    purchaseLine: { bill: { organizationId: 'org', status: 'OPEN', journalEntryId: 'je', deletedAt: null, voidedAt: null } }, ...over };
  const tx = { $queryRaw: vi.fn(async () => []), asset: { findFirst: vi.fn(async () => asset), update: vi.fn(async ({ data }) => ({ ...asset, ...data })) }, account: { findFirst: vi.fn(async () => ({ id: 'account' })) } };
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));
  return tx;
}
function req(date: string) {
  return new NextRequest('http://localhost/api/v1/assets/asset/activate', { method: 'POST', headers: { 'x-org-id': 'org', 'x-user-id': 'user', 'x-role-type': 'ADMIN', 'content-type': 'application/json' }, body: JSON.stringify({ readyForUseDate: date }) });
}
beforeEach(() => vi.clearAllMocks());
it('records the ready-for-use date without posting another purchase journal', async () => {
  const tx = fixture();
  const res = await POST(req('2026-10-15'), { params: Promise.resolve({ id: 'asset' }) });
  expect(res.status).toBe(200);
  expect(tx.asset.update.mock.calls[0][0]).toMatchObject({ data: { status: 'ACTIVE', readyForUseDate: new Date('2026-10-15') } });
  expect(tx.asset.findFirst.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org', deletedAt: null } });
});
for (const bill of [ { status: 'DRAFT', journalEntryId: null }, { status: 'VOID', journalEntryId: 'je' }, { status: 'OPEN', journalEntryId: 'je', deletedAt: new Date() } ]) {
  it(`refuses activation with an unposted/cancelled source bill ${bill.status}`, async () => {
    const tx = fixture({ purchaseLine: { bill: { organizationId: 'org', ...bill } } });
    const res = await POST(req('2026-10-15'), { params: Promise.resolve({ id: 'asset' }) });
    expect(res.status).toBe(422); expect(tx.asset.update).not.toHaveBeenCalled();
  });
}
it('refuses invalid or pre-acquisition dates', async () => {
  const tx = fixture();
  expect((await POST(req('2026-02-30'), { params: Promise.resolve({ id: 'asset' }) })).status).toBe(400);
  expect((await POST(req('2026-08-31'), { params: Promise.resolve({ id: 'asset' }) })).status).toBe(422);
  expect(tx.asset.update).not.toHaveBeenCalled();
});
it('requires valid depreciation accounts before activation', async () => {
  const tx = fixture(); tx.account.findFirst.mockResolvedValue(null as never);
  const res = await POST(req('2026-10-15'), { params: Promise.resolve({ id: 'asset' }) });
  expect(res.status).toBe(422); expect(tx.asset.update).not.toHaveBeenCalled();
});
