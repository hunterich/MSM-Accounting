import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { importMarketplaceOrders } from '@/lib/marketplace-import';
import { marketplaceInvoiceStatus } from '@/lib/marketplace-invoice';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
for (const recordPayment of [true, false]) {
  it(`records import provenance with recordPayment=${recordPayment}`, async () => {
    const org = await createTestOrg();
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Import QA' } });
    try {
      const customerId = await createCustomer(org.orgId);
      const bank = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Cash & Bank', bankName: 'Cash & Bank' } });
      const connection = await prisma.ecommerceConnection.create({ data: { organizationId: org.orgId, platform: 'SHOPEE', shopName: 'QA shop', customerId, holdingAccountId: bank.id } });
      const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'QA-1', name: 'QA item', type: 'PRODUCT', unit: 'PCS', sellingPrice: 200, costPrice: 100, openingStock: 5, isActive: true } });
      await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, new Date('2026-01-01')));
      const orderNo = `ORDER-${recordPayment}`;
      const result = await importMarketplaceOrders(org.orgId, user.id, connection.id, [{ orderNo, issueDate: '2026-06-01', lines: [{ itemId: item.id, description: item.name, sku: item.sku, quantity: 1, unitPrice: 200 }] }], { recordPayment });
      expect(result).toMatchObject({ created: 1, failed: [] });
      const invoice = await prisma.salesInvoice.findFirstOrThrow({ where: { organizationId: org.orgId, poNumber: orderNo } });
      const payments = await prisma.aRPayment.findMany({ where: { organizationId: org.orgId, allocations: { some: { invoiceId: invoice.id } } } });
      if (recordPayment) {
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({ source: 'MARKETPLACE_IMPORT', ecommerceConnectionId: connection.id, marketplaceOrderNo: orderNo });
      } else expect(payments).toHaveLength(0);
      expect(await prisma.$transaction(tx => marketplaceInvoiceStatus(tx, org.orgId, invoice.id))).toBe(recordPayment ? 'MARKETPLACE' : 'NONE');
    } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
  });
}
