import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { GET as getCatalog } from '@/src/app/api/v1/pos/catalog/route';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';

afterAll(async () => {
  await disconnect();
});

describe('POS catalog serves resolved modifier groups', () => {
  // The catalog endpoint must attach, per item, the modifier groups that apply
  // to it (item-attached ∪ category-attached), with active options ordered by
  // sortOrder. Here a "Milk" SINGLE/required group is attached to the "Coffee"
  // CATEGORY, so the "Latte" item (in that category) must carry it.
  it('attaches category-linked groups with ordered options to the item', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });

    const category = await prisma.itemCategory.create({
      data: { organizationId: org.orgId, name: 'Coffee', code: `COF-${Date.now()}` },
      select: { id: true },
    });

    const latte = await prisma.item.create({
      data: {
        organizationId: org.orgId,
        sku: `LATTE-${Date.now()}`,
        name: 'Latte',
        type: 'PRODUCT',
        isActive: true,
        categoryId: category.id,
      },
      select: { id: true },
    });

    // Item backing the "Oat" option (option.itemId -> OatMilk).
    const oatMilk = await prisma.item.create({
      data: {
        organizationId: org.orgId,
        sku: `OATMILK-${Date.now()}`,
        name: 'OatMilk',
        type: 'PRODUCT',
        isActive: true,
      },
      select: { id: true },
    });

    const milkGroup = await prisma.modifierGroup.create({
      data: {
        organizationId: org.orgId,
        name: 'Milk',
        selectionType: 'SINGLE',
        isRequired: true,
        isActive: true,
        options: {
          create: [
            { name: 'Oat', priceDelta: 5000, itemId: oatMilk.id, sortOrder: 0, isActive: true },
            { name: 'Regular', priceDelta: 0, itemId: null, sortOrder: 1, isActive: true },
          ],
        },
        attachments: {
          create: [{ organizationId: org.orgId, itemCategoryId: category.id }],
        },
      },
      select: { id: true },
    });

    const req = new NextRequest('http://localhost/api/v1/pos/catalog', {
      method: 'GET',
      headers: { 'x-org-id': org.orgId, 'x-user-id': 'admin-1', 'x-role-type': 'ADMIN' },
    });

    const res = await getCatalog(req);
    expect(res.status).toBe(200);
    const raw = await res.json();
    // The catalog endpoint returns { items, salesTypes }; older shape was a bare array.
    const body = Array.isArray(raw) ? raw : (raw.items ?? raw.data ?? []);

    const latteEntry = body.find((i: { id: string }) => i.id === latte.id);
    expect(latteEntry).toBeDefined();
    expect(latteEntry.modifierGroups).toHaveLength(1);
    expect(latteEntry.modifierGroups[0]).toMatchObject({
      id: milkGroup.id,
      selectionType: 'SINGLE',
      isRequired: true,
    });
    expect(latteEntry.modifierGroups[0].options.map((o: { name: string }) => o.name)).toEqual([
      'Oat',
      'Regular',
    ]);

    await cleanupOrg(org.orgId);
  });
});

describe('POS checkout materializes modifiers end-to-end', () => {
  // End-to-end proof that a modified cart line posts correctly:
  //  - item-linked options ("Oat") become CHILD invoice lines that draw stock
  //    and post COGS via the existing postInvoiceSend engine;
  //  - price-only options ("Large") become CHILD lines with no item (no stock);
  //  - free options ("No sugar") collapse into the base line's modifierNote;
  //  - the whole fresh org's GL stays balanced (Σdebit === Σcredit).
  it('materializes modifiers as child lines with correct stock + balanced GL', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });

    // The posting engine resolves the tax + COGS accounts the org needs. The
    // chart from createTestOrg carries COGS (5100); add the output-tax account
    // so the tax-inclusive AR entry can book PPN.
    await prisma.account.upsert({
      where: { organizationId_code: { organizationId: org.orgId, code: '2130' } },
      update: {},
      create: { organizationId: org.orgId, code: '2130', name: 'Output Tax Payable (PPN)', type: 'LIABILITY', normalSide: 'CREDIT' },
    });

    // postPosSale resolves the customer by code 'WALK-IN' when none is passed.
    await prisma.customer.create({
      data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in Customer' },
    });

    // Base sellable item. It is a PRODUCT, so its base line also relieves stock
    // + posts COGS through postInvoiceSend — seed it real drawable stock too, or
    // the sale would throw "Insufficient stock".
    const coffee = await prisma.item.create({
      data: { organizationId: org.orgId, sku: `COFFEE-${Date.now()}`, name: 'Coffee', type: 'PRODUCT', sellingPrice: 20000, costPrice: 8000, requiresBatchTracking: true },
      select: { id: true },
    });

    // Item backing the "Oat" modifier option. As a child line with itemId set it
    // draws stock + posts COGS exactly like a normal sold item.
    const oatMilk = await prisma.item.create({
      data: { organizationId: org.orgId, sku: `OATMILK-${Date.now()}`, name: 'OatMilk', type: 'PRODUCT', sellingPrice: 5000, costPrice: 2000, requiresBatchTracking: true },
      select: { id: true },
    });

    const register = await prisma.posRegister.create({
      data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId },
      select: { id: true },
    });
    const shift = await prisma.posShift.create({
      data: { organizationId: org.orgId, registerId: register.id, cashierId: 'user-cashier', openingFloat: 100000, status: 'OPEN' },
      select: { id: true },
    });

    // Seed drawable stock: 10 Coffee, 10 OatMilk. Both are batch-tracked, so
    // receiveBatch builds the physical StockBatch + the FIFO cost layer.
    await prisma.$transaction((tx) =>
      receiveBatch(tx, org.orgId, { itemId: coffee.id, warehouseId: org.warehouseId, batchNumber: 'COFFEE-1', expiryDate: new Date('2027-01-01'), qty: 10, unitCost: 8000, date: new Date('2026-07-01') }),
    );
    await prisma.$transaction((tx) =>
      receiveBatch(tx, org.orgId, { itemId: oatMilk.id, warehouseId: org.warehouseId, batchNumber: 'OATMILK-1', expiryDate: new Date('2027-01-01'), qty: 10, unitCost: 2000, date: new Date('2026-07-01') }),
    );

    // Cart convention: base line price = item base + Σ priceDelta of selected
    // options (20000 + 5000 + 3000; the free option adds 0). postPosSale strips
    // the deltas so the base line carries 20000 and each option is its own line.
    const input: PosSaleInput = {
      clientSaleId: 'client-modifiers-1',
      registerId: register.id,
      shiftId: shift.id,
      cashierId: 'user-cashier',
      warehouseId: null,
      lines: [
        {
          itemId: coffee.id,
          description: 'Coffee',
          quantity: 2,
          price: 28000,
          discountPct: 0,
          modifiers: [
            { groupId: 'g1', groupName: 'Milk', optionId: 'oat', optionName: 'Oat', priceDelta: 5000, itemId: oatMilk.id },
            { groupId: 'g2', groupName: 'Size', optionId: 'lg', optionName: 'Large', priceDelta: 3000, itemId: null },
            { groupId: 'g3', groupName: 'Sugar', optionId: 'no', optionName: 'No sugar', priceDelta: 0, itemId: null },
          ],
        },
      ],
      tenders: [{ method: 'CASH', amount: 100000 }],
      date: new Date('2026-07-03'),
    };

    const res = await prisma.$transaction((tx) => postPosSale(tx, org.orgId, input));

    const inv = await prisma.salesInvoice.findUnique({
      where: { id: res.salesInvoiceId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    expect(inv).not.toBeNull();

    // base + oat child + large child = 3 lines (No sugar is a note, not a line).
    expect(inv!.lines).toHaveLength(3);
    expect(inv!.lines[0]).toMatchObject({ isModifier: false, modifierNote: 'No sugar', itemId: coffee.id });
    // Base line price is the item base with the deltas stripped back out.
    expect(Number(inv!.lines[0].price)).toBe(20000);

    const oat = inv!.lines.find((l) => l.itemId === oatMilk.id);
    expect(oat).toMatchObject({ isModifier: true, parentLineNo: 1 });
    expect(Number(oat!.price)).toBe(5000);
    expect(Number(oat!.quantity)).toBe(2);

    const large = inv!.lines.find((l) => l.isModifier && l.itemId === null);
    expect(large).toBeDefined();
    expect(Number(large!.price)).toBe(3000);
    expect(Number(large!.quantity)).toBe(2);

    // OatMilk stock decremented by 2 (10 seeded → 8 on hand).
    const oatBatch = await prisma.stockBatch.findFirst({
      where: { organizationId: org.orgId, itemId: oatMilk.id, batchNumber: 'OATMILK-1' },
      select: { qtyOnHand: true },
    });
    expect(Number(oatBatch!.qtyOnHand)).toBe(8);
    // Sanity: the price-only "Large" option drew no stock; base Coffee drew 2.
    const coffeeBatch = await prisma.stockBatch.findFirst({
      where: { organizationId: org.orgId, itemId: coffee.id, batchNumber: 'COFFEE-1' },
      select: { qtyOnHand: true },
    });
    expect(Number(coffeeBatch!.qtyOnHand)).toBe(8);

    // The whole fresh org's GL is balanced: Σdebit === Σcredit across every line.
    const lines = await prisma.journalLine.findMany({
      where: { entry: { organizationId: org.orgId } },
      select: { debit: true, credit: true },
    });
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(Math.round((debit - credit) * 100) / 100).toBe(0);

    await cleanupOrg(org.orgId);
  });
});
