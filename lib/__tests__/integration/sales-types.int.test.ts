import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';

afterAll(async () => {
  await disconnect();
});

/**
 * Shared setup: a fresh org with the WALK-IN customer, an output-tax account (so
 * a taxable tax-inclusive AR entry can book PPN), one batch-tracked item stocked
 * via receiveBatch, a register, and an OPEN shift. Mirrors pos-modifiers.int.test.
 */
async function setupOrg(goodsUnitPrice: number) {
  const org = await createTestOrg({ costingMethod: 'FIFO' });

  // Output tax account (arTax) — resolves by the 'tax payable' keyword.
  await prisma.account.create({
    data: { organizationId: org.orgId, code: '2130', name: 'Output Tax Payable (PPN)', type: 'LIABILITY', normalSide: 'CREDIT', isActive: true, isPostable: true },
  });

  await prisma.customer.create({
    data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in Customer' },
  });

  const item = await prisma.item.create({
    data: { organizationId: org.orgId, sku: `GOODS-${Date.now()}`, name: 'Goods', type: 'PRODUCT', sellingPrice: goodsUnitPrice, costPrice: 40000, requiresBatchTracking: true },
    select: { id: true },
  });

  await prisma.$transaction((tx) =>
    receiveBatch(tx, org.orgId, { itemId: item.id, warehouseId: org.warehouseId, batchNumber: 'GOODS-1', expiryDate: new Date('2027-01-01'), qty: 10, unitCost: 40000, date: new Date('2026-07-01') }),
  );

  const register = await prisma.posRegister.create({
    data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId },
    select: { id: true },
  });
  const shift = await prisma.posShift.create({
    data: { organizationId: org.orgId, registerId: register.id, cashierId: 'user-cashier', openingFloat: 100000, status: 'OPEN' },
    select: { id: true },
  });

  return { org, item, register, shift };
}

async function glBalance(orgId: string) {
  const jl = await prisma.journalLine.findMany({
    where: { entry: { organizationId: orgId } },
    select: { debit: true, credit: true },
  });
  const d = jl.reduce((s, l) => s + Number(l.debit), 0);
  const c = jl.reduce((s, l) => s + Number(l.credit), 0);
  return Math.round((d - c) * 100) / 100;
}

describe('POS sales type applies tax + service charge', () => {
  // A 1% taxable service charge from the register's default sales type must:
  //  - tag the invoice with the sales type,
  //  - add exactly one SalesInvoiceCharge booked to the type's income account,
  //  - keep the whole fresh org's GL balanced (the charge credits its income
  //    account, its embedded PPN lands in output tax, AR is fully settled).
  it('books a 1% charge to the type income account and keeps GL balanced', async () => {
    const goodsTotal = 100000;
    const { org, register } = await setupOrg(goodsTotal);

    // Distinct REVENUE account for the service charge — NOT salesRevenue (4100),
    // so invoice-send-posting credits it separately instead of folding into sales.
    const income = await prisma.account.create({
      data: { organizationId: org.orgId, code: '4200', name: 'Service Charge Income', type: 'REVENUE', normalSide: 'CREDIT', isActive: true, isPostable: true },
      select: { id: true },
    });

    const salesType = await prisma.salesType.create({
      data: { organizationId: org.orgId, name: 'Online', channel: 'ONLINE', serviceChargePct: 1, taxable: true, chargeAccountId: income.id },
      select: { id: true },
    });
    const salesTypeId = salesType.id;

    await prisma.posRegister.update({ where: { id: register.id }, data: { defaultSalesTypeId: salesTypeId } });

    const input: PosSaleInput = {
      clientSaleId: 'client-salestype-1',
      registerId: register.id,
      shiftId: (await prisma.posShift.findFirstOrThrow({ where: { registerId: register.id }, select: { id: true } })).id,
      cashierId: 'user-cashier',
      warehouseId: null,
      // NO explicit salesTypeId — must pick up the register default.
      lines: [{ itemId: (await prisma.item.findFirstOrThrow({ where: { organizationId: org.orgId, sku: { startsWith: 'GOODS-' } }, select: { id: true } })).id, description: 'Goods', quantity: 1, price: goodsTotal, discountPct: 0 }],
      tenders: [{ method: 'CASH', amount: 200000 }],
      date: new Date('2026-07-03'),
    };

    const res = await prisma.$transaction((tx) => postPosSale(tx, org.orgId, input));

    const inv = await prisma.salesInvoice.findUnique({ where: { id: res.salesInvoiceId }, include: { charges: true } });
    expect(inv!.salesTypeId).toBe(salesTypeId);
    expect(inv!.charges).toHaveLength(1);
    expect(Number(inv!.charges[0].amount)).toBeCloseTo(Math.round(goodsTotal * 0.01 * 100) / 100, 2);
    expect(inv!.charges[0].accountId).toBe(income.id);
    // Customer paid goods + 1% charge.
    expect(Number(inv!.totalAmount)).toBeCloseTo(goodsTotal + 1000, 2);

    expect(await glBalance(org.orgId)).toBe(0);

    await cleanupOrg(org.orgId);
  });

  // A sales type with 0% charge still tags the invoice but adds no charge row and
  // leaves the customer-paid total equal to the goods total.
  it('adds no charge when serviceChargePct is 0 but still tags the invoice', async () => {
    const goodsTotal = 100000;
    const { org, register } = await setupOrg(goodsTotal);

    const salesType = await prisma.salesType.create({
      data: { organizationId: org.orgId, name: 'Dine-in', channel: 'OFFLINE', serviceChargePct: 0, taxable: true, chargeAccountId: null },
      select: { id: true },
    });
    const salesTypeId = salesType.id;
    await prisma.posRegister.update({ where: { id: register.id }, data: { defaultSalesTypeId: salesTypeId } });

    const input: PosSaleInput = {
      clientSaleId: 'client-salestype-0',
      registerId: register.id,
      shiftId: (await prisma.posShift.findFirstOrThrow({ where: { registerId: register.id }, select: { id: true } })).id,
      cashierId: 'user-cashier',
      warehouseId: null,
      lines: [{ itemId: (await prisma.item.findFirstOrThrow({ where: { organizationId: org.orgId, sku: { startsWith: 'GOODS-' } }, select: { id: true } })).id, description: 'Goods', quantity: 1, price: goodsTotal, discountPct: 0 }],
      tenders: [{ method: 'CASH', amount: 200000 }],
      date: new Date('2026-07-03'),
    };

    const res = await prisma.$transaction((tx) => postPosSale(tx, org.orgId, input));

    const inv = await prisma.salesInvoice.findUnique({ where: { id: res.salesInvoiceId }, include: { charges: true } });
    expect(inv!.salesTypeId).toBe(salesTypeId);
    expect(inv!.charges).toHaveLength(0);
    expect(Number(inv!.totalAmount)).toBeCloseTo(goodsTotal, 2);

    expect(await glBalance(org.orgId)).toBe(0);

    await cleanupOrg(org.orgId);
  });
});
