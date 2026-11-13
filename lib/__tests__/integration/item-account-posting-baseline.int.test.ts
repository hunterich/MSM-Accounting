import { afterAll, describe, expect, it } from 'vitest';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { accountBalance, createCustomer, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

describe('item inventory account posting', () => {
  it('relieves the item account used by opening stock when one unit is sold', async () => {
    const org = await createTestOrg();
    const itemAccount = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'ACCOUNT-BASELINE', name: 'Mapped product', costPrice: 100, openingStock: 2, inventoryAccountId: itemAccount.id } });
    const date = new Date('2026-01-01T00:00:00Z');
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
    const opening = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: org.orgId, itemId: item.id, documentType: 'OPENING' } });
    expect(opening.inventoryPostingAccountId).toBe(itemAccount.id);
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'ITEM-ACCOUNT-BASELINE', issueDate: date,
      status: 'SENT', subtotal: 200, totalAmount: 200, taxEnabled: false, taxRate: 0,
      lines: { create: { itemId: item.id, description: 'Mapped product', lineNo: 1, quantity: 1, price: 200, lineSubtotal: 200 } } } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));

    expect(await accountBalance(org.orgId, itemAccount.id)).toBe(100);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(0);
    const ledger = await prisma.inventoryLedgerEntry.aggregate({ where: { organizationId: org.orgId, itemId: item.id }, _sum: { valueChange: true } });
    expect(Number(ledger._sum.valueChange)).toBe(100);
  });
});
