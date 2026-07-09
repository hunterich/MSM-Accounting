import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';

afterAll(async () => { await disconnect(); });

/** A service org: a non-stock SERVICE item, walk-in customer, COGS + PPN
 *  accounts, a register and an open shift keyed to a cashier user id. */
async function setup(cashierUserId: string): Promise<{ org: TestOrg; itemId: string; registerId: string; shiftId: string }> {
  const org = await createTestOrg({ costingMethod: 'FIFO' });
  await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.orgId, code: '5100' } },
    update: {},
    create: { organizationId: org.orgId, code: '5100', name: 'COGS', type: 'EXPENSE', normalSide: 'DEBIT' },
  });
  await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.orgId, code: '2130' } },
    update: {},
    create: { organizationId: org.orgId, code: '2130', name: 'Output Tax Payable (PPN)', type: 'LIABILITY', normalSide: 'CREDIT' },
  });
  await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in' } });
  const item = await prisma.item.create({
    data: { organizationId: org.orgId, sku: `SVC-${Date.now()}`, name: 'Haircut', type: 'SERVICE', sellingPrice: 50000, requiresBatchTracking: false },
    select: { id: true },
  });
  const register = await prisma.posRegister.create({
    data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId },
    select: { id: true },
  });
  const shift = await prisma.posShift.create({
    data: { organizationId: org.orgId, registerId: register.id, cashierId: cashierUserId, openingFloat: 0, status: 'OPEN' },
    select: { id: true },
  });
  return { org, itemId: item.id, registerId: register.id, shiftId: shift.id };
}

function saleInput(o: { itemId: string; registerId: string; shiftId: string }, cashierId: string, clientSaleId: string, performedById?: string): PosSaleInput {
  return {
    clientSaleId, registerId: o.registerId, shiftId: o.shiftId, cashierId, warehouseId: null,
    lines: [{ itemId: o.itemId, description: 'Haircut', quantity: 1, price: 50000, discountPct: 0, performedById }],
    tenders: [{ method: 'CASH', amount: 50000 }],
    date: new Date('2026-07-10T05:00:00Z'),
  };
}

describe('POS line attribution', () => {
  it('defaults each line to the cashier\'s linked staff record', async () => {
    const user = await prisma.user.create({ data: { email: `cash-${Date.now()}@x.com`, fullName: 'Cashier', passwordHash: 'x' }, select: { id: true } });
    const o = await setup(user.id);
    const emp = await prisma.employee.create({
      data: { organizationId: o.org.orgId, employeeNo: `E-${Date.now()}`, name: 'Ani', joinDate: new Date('2026-01-01'), userId: user.id },
      select: { id: true },
    });
    const res = await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, saleInput(o, user.id, 'attr-default')));
    const line = await prisma.salesInvoiceLine.findFirst({ where: { invoiceId: res.salesInvoiceId }, select: { performedById: true } });
    expect(line?.performedById).toBe(emp.id);
    await cleanupOrg(o.org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it('honors an explicit per-line performer and leaves it null when the cashier has no staff record', async () => {
    const user = await prisma.user.create({ data: { email: `cash2-${Date.now()}@x.com`, fullName: 'Cashier2', passwordHash: 'x' }, select: { id: true } });
    const o = await setup(user.id); // NOTE: no Employee linked to this user
    const stylist = await prisma.employee.create({
      data: { organizationId: o.org.orgId, employeeNo: `S-${Date.now()}`, name: 'Budi', joinDate: new Date('2026-01-01') },
      select: { id: true },
    });
    const explicit = await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, saleInput(o, user.id, 'attr-explicit', stylist.id)));
    const l1 = await prisma.salesInvoiceLine.findFirst({ where: { invoiceId: explicit.salesInvoiceId }, select: { performedById: true } });
    expect(l1?.performedById).toBe(stylist.id);

    const none = await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, saleInput(o, user.id, 'attr-none')));
    const l2 = await prisma.salesInvoiceLine.findFirst({ where: { invoiceId: none.salesInvoiceId }, select: { performedById: true } });
    expect(l2?.performedById).toBeNull();

    await cleanupOrg(o.org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });
});
