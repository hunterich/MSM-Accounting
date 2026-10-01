import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { assetLineCost, prepareAssetLines } from '../asset-purchases';
import type { BillInput } from '@/types/api';

const header = { issueDate: '2026-10-01', taxable: true, taxInclusive: true, taxRate: 11 };
const line = (over = {}): BillInput['lines'][number] => ({ description: 'Laptop', quantity: 1, price: 1110, unit: 'PCS',
  assetPurchase: { mode: 'CREATE', name: 'Laptop', categoryId: 'cat' }, ...over });
function fixture(over: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn(async () => [{ max: 4 }]),
    assetCategory: { findFirst: vi.fn(async () => ({ id: 'cat', assetAccountId: 'fixed', usefulLifeMonths: 36, salvagePercent: 10, depreciationMethod: 'STRAIGHT_LINE' })) },
    account: { findFirst: vi.fn(async () => ({ id: 'fixed', type: 'ASSET' })) },
    asset: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: 'a5', ...data })), update: vi.fn(async ({ data }) => ({ id: 'a1', ...data })) },
    ...over,
  };
  return tx;
}
describe('asset purchase costing and draft links', () => {
  it('capitalizes the discounted net cost and excludes recoverable inclusive tax', async () => {
    expect(Number(assetLineCost(line({ discountPct: 10 }), header))).toBe(900);
    expect(Number(assetLineCost(line(), { taxable: false, taxInclusive: true, taxRate: 11 }))).toBe(1110);
    const tx = fixture();
    const result = await prepareAssetLines(tx as never, 'org', 'bill', [line({ lineTotal: 1 })], header);
    expect(result[0]).toMatchObject({ assetId: 'a5', accountId: 'fixed', lineTotal: 1110 });
    expect(tx.asset.create.mock.calls[0][0].data).toMatchObject({ name: 'Laptop', assetNo: 'ASSET-000005', usefulLifeMonths: 36, status: 'DRAFT' });
    expect(Number(tx.asset.create.mock.calls[0][0].data.acquisitionCost)).toBe(1000);
    expect(Number(tx.asset.create.mock.calls[0][0].data.salvageValue)).toBe(100);
  });
  it('updates the linked draft cost on edits without creating another asset', async () => {
    const tx = fixture();
    tx.asset.findFirst.mockResolvedValue({ id: 'a1', categoryId: 'cat', status: 'DRAFT', salvageValue: new Prisma.Decimal(0), purchaseLine: { billId: 'bill' } } as never);
    await prepareAssetLines(tx as never, 'org', 'bill', [line({ assetPurchase: { mode: 'LINK', assetId: 'a1' } })], header);
    expect(tx.asset.create).not.toHaveBeenCalled();
    expect(Number(tx.asset.update.mock.calls[0][0].data.bookValue)).toBe(1000);
    expect(tx.asset.findFirst.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org', deletedAt: null } });
  });
  for (const over of [{ quantity: 2 }, { itemId: 'inventory' }, { purchaseOrderLineId: 'po-line' }]) {
    it(`refuses an inventory/receipt or multi-asset line ${JSON.stringify(over)}`, async () => {
      const tx = fixture();
      await expect(prepareAssetLines(tx as never, 'org', 'bill', [line(over)], header)).rejects.toThrow(/one asset per bill line/);
      expect(tx.asset.create).not.toHaveBeenCalled();
    });
  }
  for (const asset of [null, { status: 'ACTIVE' }, { status: 'DRAFT', purchaseLine: { billId: 'another-bill' } }]) {
    it(`refuses unavailable or claimed assets ${JSON.stringify(asset)}`, async () => {
      const tx = fixture(); tx.asset.findFirst.mockResolvedValue(asset as never);
      await expect(prepareAssetLines(tx as never, 'org', 'bill', [line({ assetPurchase: { mode: 'LINK', assetId: 'a1' } })], header)).rejects.toThrow(/unlinked draft/);
    });
  }
  it('refuses missing category accounts instead of falling back to expenses', async () => {
    const tx = fixture(); tx.account.findFirst.mockResolvedValue(null as never);
    await expect(prepareAssetLines(tx as never, 'org', 'bill', [line()], header)).rejects.toThrow(/postable asset account/);
    expect(tx.asset.create).not.toHaveBeenCalled();
  });
  it('refuses salvage above capitalized net cost', async () => {
    const tx = fixture();
    await expect(prepareAssetLines(tx as never, 'org', 'bill', [line({ assetPurchase: { mode: 'CREATE', name: 'Laptop', categoryId: 'cat', salvageValue: 1001 } })], header)).rejects.toThrow(/Salvage/);
  });
});
