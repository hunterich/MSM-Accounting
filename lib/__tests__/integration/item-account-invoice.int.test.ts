import { afterAll, describe, expect, it } from 'vitest';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { voidInvoice } from '@/lib/invoice-void';
import { accountBalance, createCustomer, createTestOrg, disconnect, prisma } from './harness';
import type { Prisma } from '@prisma/client';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');

describe('invoice item account posting', () => {
  it('blank accounts preserve the original sales and COGS journals', async () => {
    const org = await createTestOrg();
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'BLANK', name: 'Blank accounts', costPrice: 100, openingStock: 2 } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'BLANK-INV', issueDate: date,
      status: 'SENT', subtotal: 200, totalAmount: 200, taxEnabled: false, taxRate: 0,
      lines: { create: { itemId: item.id, description: 'Item', lineNo: 1, quantity: 1, price: 200, lineSubtotal: 200 } } } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
    const entries = await prisma.journalEntry.findMany({ where: { organizationId: org.orgId, memo: { in: ['Sales recognition: BLANK-INV', 'COGS auto-post: BLANK-INV'] } }, include: { lines: { orderBy: { lineNo: 'asc' } } }, orderBy: { memo: 'asc' } });
    const actual = entries.map(e => ({ memo: e.memo, lines: e.lines.map(l => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })) }));
    expect(actual).toEqual([
      { memo: 'COGS auto-post: BLANK-INV', lines: [{ accountId: org.accounts.cogsExpense, debit: 100, credit: 0 }, { accountId: org.accounts.inventoryAsset, debit: 0, credit: 100 }] },
      { memo: 'Sales recognition: BLANK-INV', lines: [{ accountId: org.accounts.arControl, debit: 200, credit: 0 }, { accountId: org.accounts.salesRevenue, debit: 0, credit: 200 }] },
    ]);
  });

  it('allocates mixed item revenues and costs while retaining the total tax and discount', async () => {
    const org = await createTestOrg();
    const customInventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1399', name: 'Item Inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const customRevenue = await prisma.account.create({ data: { organizationId: org.orgId, code: '4199', name: 'Item Sales', type: 'REVENUE', normalSide: 'CREDIT' } });
    const customCogs = await prisma.account.create({ data: { organizationId: org.orgId, code: '5199', name: 'Item COGS', type: 'EXPENSE', normalSide: 'DEBIT' } });
    const discount = await prisma.account.create({ data: { organizationId: org.orgId, code: '5299', name: 'Sales Discount', type: 'EXPENSE', normalSide: 'DEBIT' } });
    const tax = await prisma.account.create({ data: { organizationId: org.orgId, code: '2299', name: 'Output Tax', type: 'LIABILITY', normalSide: 'CREDIT' } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: { ...org.accounts, salesDiscount: discount.id, arTax: tax.id } as Prisma.InputJsonValue } });
    const custom = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'CUSTOM', name: 'Custom', openingStock: 2, costPrice: 40, inventoryAccountId: customInventory.id, revenueAccountId: customRevenue.id, cogsAccountId: customCogs.id } });
    const fallback = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'DEFAULT', name: 'Default', openingStock: 2, costPrice: 60 } });
    await prisma.$transaction(async tx => { await postOpeningStockIfNeeded(tx, org.orgId, custom.id, date); await postOpeningStockIfNeeded(tx, org.orgId, fallback.id, date); });
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'MIXED-INV', issueDate: date,
      status: 'SENT', subtotal: 300, discountAmount: 30, totalAmount: '299.70', taxAmount: '29.70', taxEnabled: true, taxRate: 11,
      lines: { create: [
        { itemId: custom.id, description: 'Custom', lineNo: 1, quantity: 1, price: 100, lineSubtotal: 100 },
        { itemId: fallback.id, description: 'Default', lineNo: 2, quantity: 1, price: 200, lineSubtotal: 200 },
      ] } } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
    const recognition = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.orgId, memo: 'Sales recognition: MIXED-INV' }, include: { lines: true } });
    const amount = (id: string, side: 'debit' | 'credit') => Number(recognition.lines.find(line => line.accountId === id)?.[side] ?? 0);
    expect(amount(customRevenue.id, 'credit')).toBe(100);
    expect(amount(org.accounts.salesRevenue, 'credit')).toBe(200);
    expect(amount(discount.id, 'debit')).toBe(30);
    expect(amount(tax.id, 'credit')).toBe(29.7);
    expect(amount(org.accounts.arControl, 'debit')).toBe(299.7);
    expect(await accountBalance(org.orgId, customInventory.id)).toBe(40);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(60);
    expect(await accountBalance(org.orgId, customCogs.id)).toBe(40);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(60);
    const lines = await prisma.salesInvoiceLine.findMany({ where: { invoiceId: invoice.id }, orderBy: { lineNo: 'asc' } });
    expect(lines.map(line => [line.revenuePostingAccountId, line.inventoryPostingAccountId, line.cogsPostingAccountId])).toEqual([
      [customRevenue.id, customInventory.id, customCogs.id], [org.accounts.salesRevenue, org.accounts.inventoryAsset, org.accounts.cogsExpense],
    ]);
    const movements = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId, documentId: invoice.id, documentType: 'SALES' } });
    expect(movements.find(m => m.itemId === custom.id)).toMatchObject({ inventoryPostingAccountId: customInventory.id, cogsPostingAccountId: customCogs.id });
    expect(movements.find(m => m.itemId === fallback.id)).toMatchObject({ inventoryPostingAccountId: org.accounts.inventoryAsset, cogsPostingAccountId: org.accounts.cogsExpense });
  });

  it('rejects a stored invalid revenue account without leaving a journal or stock movement', async () => {
    const org = await createTestOrg();
    const foreign = await createTestOrg();
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'BAD-REVENUE', name: 'Invalid mapping', openingStock: 1, costPrice: 50, revenueAccountId: foreign.accounts.salesRevenue } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'BAD-INV', issueDate: date, status: 'DRAFT', subtotal: 100, totalAmount: 100,
      lines: { create: { itemId: item.id, description: 'Invalid mapping', lineNo: 1, quantity: 1, price: 100, lineSubtotal: 100 } } } });
    const beforeJournals = await prisma.journalEntry.count({ where: { organizationId: org.orgId } });
    const beforeLedger = await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } });
    await expect(prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id))).rejects.toThrow(/revenue item account/);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(beforeJournals);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } })).toBe(beforeLedger);
  });

  it('rejects a sale of old stock with unknown account history without partial postings', async () => {
    const org = await createTestOrg();
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'LEGACY-STOCK', name: 'Legacy stock', openingStock: 1, costPrice: 50 } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
    await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: org.orgId, itemId: item.id, documentType: 'OPENING' }, data: { inventoryPostingAccountId: null } });
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'LEGACY-INV', issueDate: date, status: 'DRAFT', subtotal: 100, totalAmount: 100,
      lines: { create: { itemId: item.id, description: 'Legacy', lineNo: 1, quantity: 1, price: 100, lineSubtotal: 100 } } } });
    const journals = await prisma.journalEntry.count({ where: { organizationId: org.orgId } });
    await expect(prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id))).rejects.toThrow(/account history is unavailable/i);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(journals);
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId, documentId: invoice.id } })).toBe(0);
    expect(Number((await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, itemId: item.id } })).qtyBalance)).toBe(1);
  });

  it('voids a sale using the accounts recorded before the item mapping changed', async () => {
    const org = await createTestOrg();
    const inventory = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Item stock', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'VOID-ITEM', name: 'Item', openingStock: 2, costPrice: 100, inventoryAccountId: inventory.id } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'VOID-ITEM-INV', issueDate: date, status: 'SENT', subtotal: 200, totalAmount: 200,
      lines: { create: { itemId: item.id, description: 'Item', lineNo: 1, quantity: 1, price: 200, lineSubtotal: 200 } } } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
    await prisma.item.update({ where: { id: item.id }, data: { inventoryAccountId: org.accounts.inventoryAsset } });
    await prisma.$transaction(tx => voidInvoice(tx, org.orgId, invoice.id, { date }));
    expect(await accountBalance(org.orgId, inventory.id)).toBe(200);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(0);
    const restored = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: invoice.id, documentType: 'ADJUSTMENT', qtyIn: { gt: 0 } } });
    expect(restored.inventoryPostingAccountId).toBe(inventory.id);
  });
});
