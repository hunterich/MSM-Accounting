import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { openShift, closeShift } from '@/lib/pos/shift';

afterAll(async () => {
  await disconnect();
});

describe('shift lifecycle', () => {
  it('opens a shift, then closes with expected cash + variance and a Z-report', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const register = await prisma.posRegister.create({
      data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId },
      select: { id: true },
    });

    const shift = await prisma.$transaction((tx) =>
      openShift(tx, org.orgId, { registerId: register.id, cashierId: 'user-cashier', openingFloat: 100000 }),
    );
    expect(shift.status).toBe('OPEN');

    const customer = await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in' }, select: { id: true } });
    const inv = await prisma.salesInvoice.create({
      data: { organizationId: org.orgId, number: `POS-${Date.now()}`, customerId: customer.id, issueDate: new Date(), status: 'SENT', totalAmount: 30000, subtotal: 27027.03, taxAmount: 2972.97 },
      select: { id: true },
    });
    await prisma.posSale.create({
      data: { organizationId: org.orgId, salesInvoiceId: inv.id, registerId: register.id, shiftId: shift.id, cashierId: 'user-cashier', clientSaleId: 'c-1', tenders: { create: [{ method: 'CASH', amount: 30000, changeGiven: 0 }] } },
    });

    const closed = await prisma.$transaction((tx) =>
      closeShift(tx, org.orgId, { shiftId: shift.id, countedCash: 128000 }),
    );

    expect(Number(closed.expectedCash)).toBe(130000);
    expect(Number(closed.cashVariance)).toBe(-2000);
    expect(closed.zReport.totalSales).toBe(30000);
    expect(closed.zReport.saleCount).toBe(1);
    expect(closed.status).toBe('CLOSED');

    await cleanupOrg(org.orgId);
  });
});
