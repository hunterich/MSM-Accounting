import { afterAll, expect, it } from 'vitest';
import { readItemCustomerSales, readItemSales, readSalesWarnings, readTopProducts } from '@/lib/sales-summary';
import { cleanupOrg, createCustomer, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

it('groups item sales by master item even when invoice descriptions differ', async () => {
  const org = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const first = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'ONE', name: 'Shared name' } });
    const second = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'TWO', name: 'Shared name' } });
    await prisma.salesInvoice.create({ data: {
      organizationId: org.orgId, customerId, number: 'INV-GROUP', issueDate: new Date('2026-01-01T00:00:00Z'),
      status: 'SENT', subtotal: 105, totalAmount: 105,
      lines: { create: [
        { lineNo: 1, itemId: first.id, description: 'Old description', quantity: 1, lineSubtotal: 10 },
        { lineNo: 2, itemId: first.id, description: 'Changed description', quantity: 2, lineSubtotal: 20 },
        { lineNo: 3, itemId: second.id, description: 'Old description', quantity: 3, lineSubtotal: 30 },
        { lineNo: 4, description: 'Manual', code: 'M1', quantity: 4, lineSubtotal: 40 },
        { lineNo: 5, description: 'Typed differently', quantity: 1, lineSubtotal: 5 },
      ] },
    } });
    const filter = { organizationId: org.orgId };
    expect(await readItemSales(prisma, filter)).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'Shared name', code: 'ONE', qty: 3, total: 30 }),
      expect.objectContaining({ description: 'Shared name', code: 'TWO', qty: 3, total: 30 }),
      expect.objectContaining({ itemId: null, description: 'No item', code: null, grossQty: 5, qty: 5, total: 45 }),
    ]));
    expect((await readItemSales(prisma, filter)).filter(row => row.itemId === null)).toHaveLength(1);
    expect(await readTopProducts(prisma, filter)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: first.id, qty: 3, total: 30 }),
      expect.objectContaining({ itemId: second.id, qty: 3, total: 30 }),
    ]));
    expect(await readTopProducts(prisma, filter)).toHaveLength(2);
    const rows = await readItemCustomerSales(prisma, filter);
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.description === 'Shared name')).toHaveLength(2);
    expect(rows.find(row => row.description === 'No item')).toMatchObject({ qty: 5, total: 45 });
  } finally {
    await cleanupOrg(org.orgId);
  }
});

it('separates invoice charges and allocates a tax-inclusive discounted item amount', async () => {
  const org = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'A', name: 'A' } });
    await prisma.salesInvoice.create({ data: {
      organizationId: org.orgId, customerId, number: 'INV-TAX', issueDate: new Date('2026-01-01T00:00:00Z'), status: 'SENT',
      subtotal: 111, discountAmount: 11.1, taxEnabled: true, taxInclusive: true, taxRate: 11, taxAmount: 9.9, totalAmount: 109.9,
      lines: { create: { lineNo: 1, itemId: item.id, description: 'A', quantity: 1, lineSubtotal: 111 } },
      charges: { create: { lineNo: 1, label: 'Delivery', amount: 10, taxRate: 0 } },
    } });
    const rows = await readItemSales(prisma, { organizationId: org.orgId });
    expect(rows).toContainEqual(expect.objectContaining({ code: 'A', total: 90 }));
    expect(rows).toContainEqual(expect.objectContaining({ description: 'Unallocated invoice charges / adjustments', total: 10 }));
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(100);
    expect(await readTopProducts(prisma, { organizationId: org.orgId })).toEqual([
      expect.objectContaining({ itemId: item.id, qty: 1, total: 90 }),
    ]);
  } finally { await cleanupOrg(org.orgId); }
});

it('preserves exact line amounts and cent allocation across different products', async () => {
  const org = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const a = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'CENT-A', name: 'A' } });
    const b = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'CENT-B', name: 'B' } });
    for (const [number, discountAmount] of [['EXACT', 0], ['DISCOUNT', 0.01]] as const) {
      await prisma.salesInvoice.create({ data: {
        organizationId: org.orgId, customerId, number, issueDate: new Date('2026-01-01T00:00:00Z'),
        status: 'SENT', subtotal: 0.03, discountAmount, totalAmount: 0.03 - discountAmount,
        lines: { create: [
          { lineNo: 1, itemId: a.id, description: 'A', quantity: 1, lineSubtotal: 0.01 },
          { lineNo: 2, itemId: b.id, description: 'B', quantity: 1, lineSubtotal: 0.02 },
        ] },
      } });
    }
    await prisma.salesInvoice.create({ data: {
      organizationId: org.orgId, customerId, number: 'NEGATIVE-LINE', issueDate: new Date('2026-01-01T00:00:00Z'),
      status: 'SENT', subtotal: 0.01, totalAmount: 0.01,
      lines: { create: [
        { lineNo: 1, itemId: a.id, description: 'A', quantity: 1, lineSubtotal: 0.03 },
        { lineNo: 2, itemId: b.id, description: 'B', quantity: 1, lineSubtotal: -0.02 },
      ] },
    } });
    expect(await readTopProducts(prisma, { organizationId: org.orgId })).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: a.id, qty: 3, total: 0.02 }),
      expect.objectContaining({ itemId: b.id, qty: 3, total: 0.03 }),
    ]));
  } finally { await cleanupOrg(org.orgId); }
});

it('recognizes a void only when all matching reversal journals share one date', async () => {
  const org = await createTestOrg();
  const otherOrg = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'VOID-ITEM', name: 'Void item' } });
    await prisma.salesInvoice.create({ data: {
      organizationId: org.orgId, customerId, number: 'INV-VOID-MULTI', issueDate: new Date('2026-01-05T00:00:00Z'),
      status: 'VOID', subtotal: 10, totalAmount: 10,
      lines: { create: { lineNo: 1, itemId: item.id, description: 'Void item', quantity: 1, lineSubtotal: 10 } },
    } });
    for (const suffix of ['A', 'B']) {
      await prisma.journalEntry.create({ data: { organizationId: org.orgId, entryNo: `VOID-${suffix}`,
        date: new Date('2026-02-05T00:00:00Z'), memo: 'Void invoice: INV-VOID-MULTI', source: 'REVERSAL', status: 'POSTED' } });
    }
    await prisma.journalEntry.create({ data: { organizationId: otherOrg.orgId, entryNo: 'OTHER-VOID',
      date: new Date('2026-03-05T00:00:00Z'), memo: 'Void invoice: INV-VOID-MULTI', source: 'REVERSAL', status: 'POSTED' } });
    const january = { organizationId: org.orgId, dateFrom: new Date('2026-01-01T00:00:00Z'), dateTo: new Date('2026-01-31T23:59:59Z') };
    const february = { ...january, dateFrom: new Date('2026-02-01T00:00:00Z'), dateTo: new Date('2026-02-28T23:59:59Z') };
    expect(await readTopProducts(prisma, january)).toEqual([expect.objectContaining({ itemId: item.id, qty: 1, total: 10 })]);
    expect(await readTopProducts(prisma, february)).toEqual([expect.objectContaining({ itemId: item.id, qty: -1, total: -10 })]);
    await prisma.journalEntry.create({ data: { organizationId: org.orgId, entryNo: 'VOID-C',
      date: new Date('2026-03-05T00:00:00Z'), memo: 'Void invoice: INV-VOID-MULTI', source: 'REVERSAL', status: 'POSTED' } });
    expect(await readTopProducts(prisma, january)).toEqual([]);
    expect(await readTopProducts(prisma, february)).toEqual([]);
    expect(await readSalesWarnings(prisma, org.orgId)).toEqual(expect.arrayContaining([expect.stringContaining('INV-VOID-MULTI')]));
  } finally { await cleanupOrg(otherOrg.orgId); await cleanupOrg(org.orgId); }
});
