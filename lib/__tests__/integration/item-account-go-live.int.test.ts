import { afterAll, describe, expect, it } from 'vitest';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer } from '@/lib/inventory-costing';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting';
import { assertInventoryDefaultChangeAllowed } from '@/lib/item-inventory-account-guard';
import { accountBalance, createCustomer, createTestOrg, createVendor, disconnect, prisma, type TestOrg } from './harness';

afterAll(disconnect);
const date = new Date('2026-01-01T00:00:00Z');
const later = new Date('2026-01-02T00:00:00Z');

async function paidStock(org: TestOrg, sku: string, qty = 2, cost = 100) {
  const item = await prisma.item.create({ data: { organizationId: org.orgId, sku, name: sku, openingStock: qty, costPrice: cost } });
  await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
  return item;
}

/** Same call goods-receipt-posting makes for a fully free receipt. */
async function freeGoods(org: TestOrg, itemId: string, qty = 1) {
  await prisma.$transaction(tx => addCostLayer(tx, org.orgId, itemId, null, qty, 0, InventoryDocumentType.PURCHASE, `free-${itemId}`, later, 0));
}

async function sell(org: TestOrg, itemId: string, number: string, qty = 1) {
  const customerId = await createCustomer(org.orgId);
  const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: later, status: 'SENT', subtotal: 200, totalAmount: 200, taxEnabled: false, taxRate: 0,
    lines: { create: { itemId, description: 'Sale', lineNo: 1, quantity: qty, price: 200, lineSubtotal: 200 } } } });
  await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
}

async function alternateAsset(org: TestOrg) {
  return prisma.account.create({ data: { organizationId: org.orgId, code: '1399', name: 'Other stock', type: 'ASSET', normalSide: 'DEBIT' } });
}

const changeDefault = (org: TestOrg, next: Record<string, string>) =>
  prisma.$transaction(tx => assertInventoryDefaultChangeAllowed(tx, org.orgId, next));

describe('migrated opening stock', () => {
  it('records the company default and can be sold', async () => {
    const org = await createTestOrg();
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'MIGRATED', name: 'Migrated', openingStock: 2, costPrice: 100 } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date, { postGl: false }));

    const opening = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { organizationId: org.orgId, itemId: item.id, documentType: 'OPENING' } });
    expect(opening.inventoryPostingAccountId).toBe(org.accounts.inventoryAsset);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);

    await sell(org, item.id, 'MIGRATED-SALE');
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(100);
  });
});

describe.each(['FIFO', 'WEIGHTED_AVERAGE'] as const)('free goods alongside paid stock (%s)', method => {
  it('do not block a sale of paid stock', async () => {
    const org = await createTestOrg({ costingMethod: method });
    const item = await paidStock(org, 'FREE-SALE');
    await freeGoods(org, item.id);
    await sell(org, item.id, 'FREE-SALE-INV');
    const cogs = await accountBalance(org.orgId, org.accounts.cogsExpense);
    expect(cogs).toBeGreaterThan(0);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeCloseTo(200 - cogs, 2);
  });

  it('do not block a stock decrease', async () => {
    const org = await createTestOrg({ costingMethod: method });
    const item = await paidStock(org, 'FREE-ADJ');
    await freeGoods(org, item.id);
    const adjustment = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'FREE-ADJ-1', date: later, reason: 'Count' } });
    await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: adjustment.id, number: adjustment.number, date: later, warehouseId: null,
      lines: [{ itemId: item.id, oldQty: 3, newQty: 2, unitCost: 100 }] }));
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeLessThan(200);
  });

  it('do not block a purchase return', async () => {
    const org = await createTestOrg({ costingMethod: method });
    const vendorId = await createVendor(org.orgId);
    const item = await paidStock(org, 'FREE-PR');
    await freeGoods(org, item.id);
    const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'FREE-PR-BILL', issueDate: date, status: 'OPEN', subtotal: 100, totalAmount: 100 } });
    const ret = await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId, billId: bill.id, number: 'FREE-PR-1', returnDate: later, status: 'APPROVED', returnAccountId: org.accounts.apControl,
      lines: { create: [{ lineNo: 1, itemId: item.id, description: 'Return', qtyReturn: 1 }] } } });
    await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, ret.id));
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBeLessThan(200);
  });
});

describe('free goods do not excuse real missing history', () => {
  it('still refuses paid stock with no recorded account', async () => {
    const org = await createTestOrg();
    const item = await paidStock(org, 'OLD-PAID');
    await freeGoods(org, item.id);
    await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: org.orgId, itemId: item.id, documentType: 'OPENING' }, data: { inventoryPostingAccountId: null } });
    await expect(sell(org, item.id, 'OLD-PAID-INV')).rejects.toThrow(/account history is unavailable/i);
  });
});

describe('changing the company default inventory account', () => {
  it('is refused while blank-account items hold stock', async () => {
    const org = await createTestOrg();
    await paidStock(org, 'HELD');
    const other = await alternateAsset(org);
    await expect(changeDefault(org, { ...org.accounts, inventoryAsset: other.id })).rejects.toThrow(/default Inventory account/i);
  });

  it('is refused while only inventory value remains', async () => {
    const org = await createTestOrg();
    const item = await paidStock(org, 'VALUE-ONLY');
    await prisma.inventoryLot.updateMany({ where: { organizationId: org.orgId, itemId: item.id }, data: { qtyBalance: 0, carryingValue: 0 } });
    await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: org.orgId, itemId: item.id }, data: { qtyIn: 0 } });
    const other = await alternateAsset(org);
    await expect(changeDefault(org, { ...org.accounts, inventoryAsset: other.id })).rejects.toThrow(/default Inventory account/i);
  });

  it('is allowed before any stock exists', async () => {
    const org = await createTestOrg();
    const other = await alternateAsset(org);
    await expect(changeDefault(org, { ...org.accounts, inventoryAsset: other.id })).resolves.toBeUndefined();
  });

  it('is allowed when the resolved account does not change', async () => {
    const org = await createTestOrg();
    await paidStock(org, 'SAME');
    await expect(changeDefault(org, { ...org.accounts })).resolves.toBeUndefined();
  });

  it('is allowed when only items with their own account hold stock', async () => {
    const org = await createTestOrg();
    const other = await alternateAsset(org);
    const own = await prisma.account.create({ data: { organizationId: org.orgId, code: '1398', name: 'Own stock', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: 'OWN', name: 'Own', openingStock: 1, costPrice: 100, inventoryAccountId: own.id } });
    await prisma.$transaction(tx => postOpeningStockIfNeeded(tx, org.orgId, item.id, date));
    await expect(changeDefault(org, { ...org.accounts, inventoryAsset: other.id })).resolves.toBeUndefined();
  });

  it('leaves a COGS default change free, and sales keep working after it', async () => {
    const org = await createTestOrg();
    const item = await paidStock(org, 'COGS-CHANGE');
    const altCogs = await prisma.account.create({ data: { organizationId: org.orgId, code: '5199', name: 'Other COGS', type: 'EXPENSE', normalSide: 'DEBIT' } });
    const next = { ...org.accounts, cogsExpense: altCogs.id };
    await expect(changeDefault(org, next)).resolves.toBeUndefined();
    await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: next } });
    await sell(org, item.id, 'COGS-CHANGE-INV');
    expect(await accountBalance(org.orgId, altCogs.id)).toBe(100);
  });
});
