import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prisma', () => ({
  prisma: {
    ecommerceConnection: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    salesInvoice: { findMany: vi.fn() },
    item: { findMany: vi.fn() },
  },
}));

import { prisma } from '../prisma';
import { previewMarketplaceOrders, type PreviewOrder } from '../marketplace-import-preview';

const order = (orderNo: string, itemId = 'active', missingDate = false): PreviewOrder => ({
  orderNo,
  issueDate: '2026-06-02',
  sourceTotal: 100_000,
  missingDate,
  lines: [{ itemId, description: 'Product', sku: 'SKU-1', quantity: 1, unitPrice: 100_000 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.ecommerceConnection.findFirst).mockResolvedValue({
    customerId: 'customer-1', holdingAccountId: 'wallet-1', mappings: null,
  } as never);
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    taxEnabled: true, taxDefaultRate: 11, taxInclusiveByDefault: false,
  } as never);
  vi.mocked(prisma.salesInvoice.findMany).mockResolvedValue([{ poNumber: 'existing' }] as never);
  vi.mocked(prisma.item.findMany).mockResolvedValue([
    { id: 'active', name: 'Product', isActive: true },
    { id: 'inactive', name: 'Old Product', isActive: false },
  ] as never);
});

describe('marketplace import review', () => {
  it('classifies orders and uses posted invoice totals without writing invoices', async () => {
    const result = await previewMarketplaceOrders('org-1', 'connection-1', [
      order('existing'),
      order('new'),
      order('inactive-order', 'inactive'),
      order('undated', 'active', true),
      order('unknown', 'missing'),
      order('new'),
    ], { recordPayment: true });

    expect(result.create).toBe(1);
    expect(result.alreadyImported).toBe(1);
    expect(result.blocked).toBe(4);
    expect(result.amountDifferences).toBe(1);
    expect(result.orders[1]).toMatchObject({
      status: 'create', sourceTotal: 100_000, invoiceTotal: 111_000, difference: 11_000,
    });
    expect(result.orders[2].reason).toMatch(/inactive/i);
    expect(result.orders[3].reason).toMatch(/date/i);
    expect(result.orders[4].reason).toMatch(/unknown/i);
    expect(result.orders[5].reason).toMatch(/more than once/i);
    expect(result.sourceTotal).toBe(100_000);
    expect(result.invoiceTotal).toBe(111_000);
  });

  it('flags missing customer and payment account before import', async () => {
    vi.mocked(prisma.ecommerceConnection.findFirst).mockResolvedValue({
      customerId: null, holdingAccountId: null, mappings: null,
    } as never);

    const paid = await previewMarketplaceOrders('org-1', 'connection-1', [order('new')], { recordPayment: true });
    expect(paid.paymentAccountMissing).toBe(true);
    expect(paid.setupErrors).toHaveLength(2);

    const unpaid = await previewMarketplaceOrders('org-1', 'connection-1', [order('new')], { recordPayment: false });
    expect(unpaid.paymentAccountMissing).toBe(false);
    expect(unpaid.setupErrors).toHaveLength(1);
  });
});
