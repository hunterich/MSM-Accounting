import { describe, expect, it, vi } from 'vitest';
import { prepareSalesReturnLines, originalSalesLineCost } from '../sales-return-lines';

const source = { id: 'line-1', invoiceId: 'inv-1', itemId: 'item-1', description: 'Product', quantity: 3, cogsAmount: 100 };
function tx(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn(),
    salesInvoice: { findFirst: vi.fn(async () => ({ customerId: 'customer-1', status: 'SENT', lines: [source] })) },
    salesReturnLine: { findMany: vi.fn(async () => []) },
    salesInvoiceLine: { count: vi.fn(async () => 1), update: vi.fn() },
    inventoryLedgerEntry: { findMany: vi.fn(async () => [{ qtyOut: 3, valueChange: -100 }]) },
    ...overrides,
  };
}
const line = { sourceInvoiceLineId: 'line-1', itemId: 'item-1', qtyReturn: 1, goodsReceived: false };

describe('sales return source validation', () => {
  it('preserves goods-not-received and derives sold quantity from the source', async () => {
    const result = await prepareSalesReturnLines(tx() as any, 'org-1', 'inv-1', 'customer-1', [line]);
    expect(result[0]).toMatchObject({ sourceInvoiceLineId: 'line-1', goodsReceived: false, qtySold: 3 });
  });
  it('rejects a different customer or source item', async () => {
    await expect(prepareSalesReturnLines(tx() as any, 'org-1', 'inv-1', 'other', [line])).rejects.toThrow(/customer/);
    await expect(prepareSalesReturnLines(tx() as any, 'org-1', 'inv-1', 'customer-1', [{ ...line, itemId: 'other' }])).rejects.toThrow(/match/);
  });
  it('counts all return lines against the sold quantity, including goods not received', async () => {
    const client = tx({ salesReturnLine: { findMany: vi.fn(async () => [{ ...line, qtyReturn: 2 }]) } });
    await expect(prepareSalesReturnLines(client as any, 'org-1', 'inv-1', 'customer-1', [line, line])).rejects.toThrow(/remaining/);
  });
  it('requires explicit source-line identity for repeated items', async () => {
    const client = tx({ salesInvoice: { findFirst: vi.fn(async () => ({ customerId: 'customer-1', status: 'SENT', lines: [source, { ...source, id: 'line-2' }] })) } });
    await expect(prepareSalesReturnLines(client as any, 'org-1', 'inv-1', 'customer-1', [{ itemId: 'item-1', qtyReturn: 1 }])).rejects.toThrow(/exact/);
    expect(await prepareSalesReturnLines(client as any, 'org-1', 'inv-1', 'customer-1', [line])).toHaveLength(1);
  });
});

describe('original sale costs', () => {
  it('uses the saved cost without reading current inventory or the historical ledger', async () => {
    const client = tx();
    expect(await originalSalesLineCost(client as any, 'org-1', source)).toBe(100);
    expect(client.inventoryLedgerEntry.findMany).not.toHaveBeenCalled();
  });
  it('recovers and saves the exact historical outbound value', async () => {
    const client = tx();
    expect(await originalSalesLineCost(client as any, 'org-1', { ...source, cogsAmount: null })).toBe(100);
    expect(client.salesInvoiceLine.update).toHaveBeenCalledWith({ where: { id: 'line-1' }, data: { cogsAmount: 100 } });
  });
  it('blocks missing or ambiguous historical costs rather than guessing', async () => {
    for (const client of [tx({ salesInvoiceLine: { count: vi.fn(async () => 2) } }), tx({ inventoryLedgerEntry: { findMany: vi.fn(async () => []) } })]) {
      await expect(originalSalesLineCost(client as any, 'org-1', { ...source, cogsAmount: null })).rejects.toThrow(/unavailable/);
    }
  });
});
