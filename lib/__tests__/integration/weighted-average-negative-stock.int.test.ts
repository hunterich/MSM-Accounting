import { afterAll, describe, expect, it } from 'vitest';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect, inventoryLedgerValue, accountBalance } from './harness';

afterAll(disconnect);
describe('INV-02 opt-in negative-stock compatibility', () => {
  it('keeps an explicitly allowed WA shortfall postable at the recorded estimated cost', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE', allowNegativeStock: true });
    try {
      const itemId = await createItem(org.orgId, 100), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
      const date = new Date('2026-09-10');
      const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'RECEIPT', issueDate: date,
        status: 'OPEN', totalAmount: 500, lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 5, price: 100, lineTotal: 500 } } }, include: { lines: true } });
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'NEGATIVE-SALE', issueDate: date,
        status: 'DRAFT', totalAmount: 2100, subtotal: 2100,
        lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 7, price: 300, lineSubtotal: 2100 } } } });
      await prisma.$transaction(async tx => {
        await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });
        await postInvoiceSend(tx, org.orgId, invoice.id, { allowNegativeStock: true });
      });
      expect(await inventoryLedgerValue(org.orgId)).toBe(-200);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(-200);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(700);
    } finally { await cleanupOrg(org.orgId); }
  });
});
