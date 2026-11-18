import { afterAll, expect, it } from 'vitest';
import { readItemCustomerSales, readItemSales } from '@/lib/sales-summary';
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
      status: 'SENT', subtotal: 100, totalAmount: 100,
      lines: { create: [
        { lineNo: 1, itemId: first.id, description: 'Old description', quantity: 1, lineSubtotal: 10 },
        { lineNo: 2, itemId: first.id, description: 'Changed description', quantity: 2, lineSubtotal: 20 },
        { lineNo: 3, itemId: second.id, description: 'Old description', quantity: 3, lineSubtotal: 30 },
        { lineNo: 4, description: 'Manual', code: 'M1', quantity: 4, lineSubtotal: 40 },
      ] },
    } });
    const filter = { organizationId: org.orgId };
    expect(await readItemSales(prisma, filter)).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'Shared name', code: 'ONE', qty: 3, total: 30 }),
      expect.objectContaining({ description: 'Shared name', code: 'TWO', qty: 3, total: 30 }),
      expect.objectContaining({ description: 'Manual', code: 'M1', qty: 4, total: 40 }),
    ]));
    const rows = await readItemCustomerSales(prisma, filter);
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.description === 'Shared name')).toHaveLength(2);
    expect(rows.find(row => row.description === 'Manual')).toMatchObject({ qty: 4, total: 40 });
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
  } finally { await cleanupOrg(org.orgId); }
});
