import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), auditLog: { create: vi.fn(async () => ({})) } } }));
vi.mock('@/lib/period-guard', () => ({ assertPeriodOpen: vi.fn(async () => {}) }));
vi.mock('@/lib/api-utils', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api-utils')>(), nextNumber: vi.fn(async () => 'JE-1') }));
import { prisma } from '@/lib/prisma';
import { POST } from '../assets/depreciation/run/route';

function fixture(readyForUseDate: Date | null, over = {}) {
  const tx = { $executeRaw: vi.fn(async () => 1),
    asset: { findMany: vi.fn(async () => [{ id: 'asset', assetNo: 'ASSET-1', name: 'Laptop', acquisitionDate: new Date('2026-09-01'), readyForUseDate,
      acquisitionCost: 1200, salvageValue: 0, accumulatedDepreciation: 0, usefulLifeMonths: 12, depreciationMethod: 'STRAIGHT_LINE', purchaseLine: { billId: 'bill' }, category: { depExpenseAccountId: 'dep', accumDepAccountId: 'accum' }, ...over }]), update: vi.fn(async () => ({})) },
    assetDepreciation: { findMany: vi.fn(async () => []), create: vi.fn(async (_args: unknown) => ({})) },
    account: { findMany: vi.fn(async () => [{ id: 'dep', type: 'EXPENSE', isPostable: true }, { id: 'accum', type: 'ASSET', isPostable: true }]) },
    journalEntry: { create: vi.fn(async (_args: unknown) => ({ id: 'je' })) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));
  return tx;
}
function req(month: number) {
  return new NextRequest('http://localhost/api/v1/assets/depreciation/run', { method: 'POST', headers: { 'x-org-id': 'org', 'x-user-id': 'user', 'x-role-type': 'ADMIN', 'content-type': 'application/json' }, body: JSON.stringify({ month, year: 2026 }) });
}
beforeEach(() => vi.clearAllMocks());
it('does not depreciate the purchase before the ready-for-use month', async () => {
  const tx = fixture(new Date('2026-10-31'));
  expect((await POST(req(9))).status).toBe(422);
  expect(tx.journalEntry.create).not.toHaveBeenCalled(); expect(tx.assetDepreciation.create).not.toHaveBeenCalled();
});
it('starts depreciation in the ready-for-use month without a journal predating that date', async () => {
  const tx = fixture(new Date('2026-10-31'));
  expect((await POST(req(10))).status).toBe(200);
  expect(tx.assetDepreciation.create.mock.calls[0][0]).toMatchObject({ data: { amount: 100, date: new Date(2026, 9, 31) } });
  expect(tx.journalEntry.create).toHaveBeenCalledTimes(1);
});
it('preserves acquisition-date timing for legacy assets', async () => {
  const tx = fixture(null, { purchaseLine: null });
  expect((await POST(req(9))).status).toBe(200);
  expect(tx.assetDepreciation.create.mock.calls[0][0]).toMatchObject({ data: { amount: 100, date: new Date(2026, 8, 28) } });
});
it('refuses depreciation when category posting accounts become unavailable', async () => {
  const tx = fixture(new Date('2026-10-01'));
  tx.account.findMany.mockResolvedValue([]);
  expect((await POST(req(10))).status).toBe(422);
  expect(tx.journalEntry.create).not.toHaveBeenCalled(); expect(tx.assetDepreciation.create).not.toHaveBeenCalled();
});
