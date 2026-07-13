import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';
import { GET as getSalesByType } from '@/src/app/api/v1/reports/sales/by-type/route';

/** Build a NextRequest carrying the org/actor headers the report route reads.
 *  ADMIN bypasses the permission check (matches other report int tests). */
function makeReportGet(orgId: string, from: string, to: string): NextRequest {
  const h = new Headers({
    'x-org-id': orgId,
    'x-user-id': `sales-type-reader-${randomUUID()}`,
    'x-role-type': 'ADMIN',
  });
  const url = `http://localhost/api/v1/reports/sales/by-type?from=${from}&to=${to}`;
  return new NextRequest(new URL(url), { method: 'GET', headers: h });
}

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

describe('Sales-by-Type report', () => {
  // Direct-create posted invoices tagged to two sales types (plus one untagged),
  // then drive the report route and assert per-type counts/gross + Untagged bucket.
  it('groups posted invoices by sales type with an Untagged bucket', async () => {
    const org = await createTestOrg();
    const customer = await prisma.customer.create({
      data: { organizationId: org.orgId, code: `C-${randomUUID()}`, name: 'Report Customer' },
      select: { id: true },
    });
    const online = await prisma.salesType.create({
      data: { organizationId: org.orgId, name: 'Online', channel: 'ONLINE' },
      select: { id: true, name: true },
    });
    const offline = await prisma.salesType.create({
      data: { organizationId: org.orgId, name: 'Counter', channel: 'OFFLINE' },
      select: { id: true, name: true },
    });

    const inWindow = new Date('2026-07-10T00:00:00.000Z');
    async function makeInvoice(
      salesTypeId: string | null,
      total: number,
      tax: number,
      status: 'SENT' | 'PAID' | 'DRAFT' | 'VOID' = 'SENT',
      issueDate: Date = inWindow,
    ) {
      await prisma.salesInvoice.create({
        data: {
          organizationId: org.orgId,
          number: `INV-${randomUUID()}`,
          customerId: customer.id,
          issueDate,
          status,
          salesTypeId,
          totalAmount: total,
          taxAmount: tax,
        },
      });
    }

    // Online: 2 posted invoices → gross 300000, tax 30000 → netPreTax 270000.
    await makeInvoice(online.id, 200000, 20000, 'SENT');
    await makeInvoice(online.id, 100000, 10000, 'PAID');
    // Counter: 1 posted invoice → gross 50000, no tax.
    await makeInvoice(offline.id, 50000, 0, 'SENT');
    // Untagged: 1 posted invoice with no sales type.
    await makeInvoice(null, 30000, 0, 'SENT');
    // Excluded: a DRAFT (not posted) and a VOID must not count.
    await makeInvoice(online.id, 999999, 0, 'DRAFT');
    await makeInvoice(online.id, 888888, 0, 'VOID');
    // Excluded: posted but outside the [from,to] window.
    await makeInvoice(online.id, 777777, 0, 'SENT', new Date('2026-08-01T00:00:00.000Z'));

    const res = await getSalesByType(makeReportGet(org.orgId, '2026-07-01', '2026-07-31'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string | null; name: string; channel: string | null; count: number; gross: number; netPreTax: number }> };

    const byId = new Map(body.data.map((r) => [r.id, r]));

    const onlineRow = byId.get(online.id);
    expect(onlineRow).toBeDefined();
    expect(onlineRow!.name).toBe('Online');
    expect(onlineRow!.channel).toBe('ONLINE');
    expect(onlineRow!.count).toBe(2);
    expect(onlineRow!.gross).toBe(300000);
    expect(onlineRow!.netPreTax).toBe(270000);

    const offlineRow = byId.get(offline.id);
    expect(offlineRow).toBeDefined();
    expect(offlineRow!.count).toBe(1);
    expect(offlineRow!.gross).toBe(50000);
    expect(offlineRow!.netPreTax).toBe(50000);

    const untagged = byId.get(null);
    expect(untagged).toBeDefined();
    expect(untagged!.name).toBe('Untagged');
    expect(untagged!.channel).toBeNull();
    expect(untagged!.count).toBe(1);
    expect(untagged!.gross).toBe(30000);

    // Exactly three buckets: Online, Counter, Untagged (excluded rows dropped).
    expect(body.data).toHaveLength(3);

    await cleanupOrg(org.orgId);
  });
});
