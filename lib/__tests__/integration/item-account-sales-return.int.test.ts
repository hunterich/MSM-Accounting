import { afterAll, describe, expect, it } from 'vitest';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { accountBalance, createCustomer, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');

async function fixture(custom: boolean) {
  const org = await createTestOrg();
  const inventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item inventory', type: 'ASSET', normalSide: 'DEBIT' } });
  const cogs = await prisma.account.create({ data: { organizationId: org.orgId, code: '5198', name: 'Item COGS', type: 'EXPENSE', normalSide: 'DEBIT' } });
  const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'RET', name: 'Return item', openingStock: 2, costPrice: 100, inventoryAccountId: custom ? inventory.id : null, cogsAccountId: custom ? cogs.id : null } });
  await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
  const customerId = await createCustomer(org.orgId);
  const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'RET-INV', issueDate: date, status: 'SENT', subtotal: 200, totalAmount: 200, lines: { create: { itemId: item.id, description: 'Return item', lineNo: 1, quantity: 1, price: 200, lineSubtotal: 200 } } }, include: { lines: true } });
  await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
  const ret = await prisma.salesReturn.create({ data: { organizationId: org.orgId, customerId, invoiceId: invoice.id, number: 'RET-1', returnDate: date, status: 'APPROVED', lines: { create: { lineNo: 1, sourceInvoiceLineId: invoice.lines[0].id, itemId: item.id, itemName: 'Return item', qtySold: 1, qtyReturn: 1, goodsReceived: true } } } });
  return { org, inventory, cogs, item, invoice, ret };
}

describe('sales returns use the original sale accounts', () => {
  it('blank accounts preserve the original return journal', async () => {
    const f = await fixture(false);
    await prisma.$transaction(tx => postSalesReturnOnApproval(tx, f.ret.id));
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, memo: 'Sales return inventory: RET-1' }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(entry.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)])).toEqual([[f.org.accounts.inventoryAsset, 100, 0], [f.org.accounts.cogsExpense, 0, 100]]);
  });
  it('uses the recorded sale accounts after item mappings change', async () => {
    const f = await fixture(true);
    await prisma.item.update({ where: { id: f.item.id }, data: { inventoryAccountId: f.org.accounts.inventoryAsset, cogsAccountId: f.org.accounts.cogsExpense } });
    await prisma.$transaction(tx => postSalesReturnOnApproval(tx, f.ret.id));
    expect(await accountBalance(f.org.orgId, f.inventory.id)).toBe(200);
    expect(await accountBalance(f.org.orgId, f.cogs.id)).toBe(0);
    expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
    const movement = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: f.ret.id, documentType: 'SALES_RETURN' } });
    expect(movement.inventoryPostingAccountId).toBe(f.inventory.id);
  });
  it('refuses an old sale without recorded accounts and rolls back', async () => {
    const f = await fixture(true);
    await prisma.salesInvoiceLine.update({ where: { id: f.invoice.lines[0].id }, data: { inventoryPostingAccountId: null, cogsPostingAccountId: null } });
    const before = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });
    await expect(prisma.$transaction(tx => postSalesReturnOnApproval(tx, f.ret.id))).rejects.toThrow(/account history is unavailable/i);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId, documentId: f.ret.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(before);
    expect((await prisma.salesReturn.findUniqueOrThrow({ where: { id: f.ret.id } })).postedAt).toBeNull();
  });
});
