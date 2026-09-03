import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, assertTrialBalanced, accountBalance, cleanupOrg, disconnect, TOLERANCE, type TestOrg } from './harness';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';

afterAll(async () => {
  await disconnect();
});

async function setup(): Promise<{ org: TestOrg; itemId: string; registerId: string; shiftId: string }> {
  const org = await createTestOrg({ costingMethod: 'FIFO' });
  await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.orgId, code: '5100' } },
    update: {},
    create: { organizationId: org.orgId, code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE', normalSide: 'DEBIT' },
  });
  await prisma.account.upsert({
    where: { organizationId_code: { organizationId: org.orgId, code: '2130' } },
    update: {},
    create: { organizationId: org.orgId, code: '2130', name: 'Output Tax Payable (PPN)', type: 'LIABILITY', normalSide: 'CREDIT' },
  });
  const walkIn = await prisma.customer.create({
    data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in Customer' },
    select: { id: true },
  });
  void walkIn;
  const item = await prisma.item.create({
    data: { organizationId: org.orgId, sku: `SKU-${Date.now()}`, name: 'Paracetamol 500mg', type: 'PRODUCT', sellingPrice: 5000, costPrice: 2000, requiresBatchTracking: true, drugClass: 'OBAT_BEBAS' },
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
  await prisma.$transaction((tx) =>
    receiveBatch(tx, org.orgId, { itemId: item.id, warehouseId: org.warehouseId, batchNumber: 'PCT-EARLY', expiryDate: new Date('2026-10-01'), qty: 5, unitCost: 2000, date: new Date('2026-07-01') }),
  );
  await prisma.$transaction((tx) =>
    receiveBatch(tx, org.orgId, { itemId: item.id, warehouseId: org.warehouseId, batchNumber: 'PCT-LATE', expiryDate: new Date('2027-10-01'), qty: 100, unitCost: 2000, date: new Date('2026-07-02') }),
  );
  return { org, itemId: item.id, registerId: register.id, shiftId: shift.id };
}

function saleInput(itemId: string, registerId: string, shiftId: string, clientSaleId: string): PosSaleInput {
  return {
    clientSaleId,
    registerId,
    shiftId,
    cashierId: 'user-cashier',
    warehouseId: null,
    lines: [{ itemId, description: 'Paracetamol 500mg', quantity: 6, price: 5000, discountPct: 0 }],
    tenders: [{ method: 'CASH', amount: 30000 }],
    date: new Date('2026-07-03'),
  };
}

describe('postPosSale', () => {
  it('posts a balanced cash sale, settles AR to zero, and decrements FEFO batches', async () => {
    const { org, itemId, registerId, shiftId } = await setup();
    const result = await prisma.$transaction((tx) => postPosSale(tx, org.orgId, saleInput(itemId, registerId, shiftId, 'client-1')));
    expect(result.change).toBe(0);
    expect(result.totalAmount).toBe(30000);
    const report = await assertTrialBalanced(org.orgId, 'pos sale');
    expect(report.summary.endingDebit).toBeCloseTo(report.summary.endingCredit, TOLERANCE);
    const invoice = await prisma.salesInvoice.findUnique({ where: { id: result.salesInvoiceId }, select: { status: true } });
    // A POS sale is settled by its own cash receipt, so it lands as PAID.
    expect(invoice?.status).toBe('PAID');
    const early = await prisma.stockBatch.findFirst({ where: { organizationId: org.orgId, itemId, batchNumber: 'PCT-EARLY' }, select: { qtyOnHand: true } });
    const late = await prisma.stockBatch.findFirst({ where: { organizationId: org.orgId, itemId, batchNumber: 'PCT-LATE' }, select: { qtyOnHand: true } });
    expect(Number(early?.qtyOnHand)).toBe(0);
    expect(Number(late?.qtyOnHand)).toBe(99);
    const arAccount = await prisma.account.findFirst({ where: { organizationId: org.orgId, code: '1210' }, select: { id: true } });
    const arBalance = await accountBalance(org.orgId, arAccount!.id);
    expect(Math.abs(arBalance)).toBeLessThan(TOLERANCE);
    await cleanupOrg(org.orgId);
  });

  it('is idempotent on clientSaleId (replay returns the same sale, no double-post)', async () => {
    const { org, itemId, registerId, shiftId } = await setup();
    const first = await prisma.$transaction((tx) => postPosSale(tx, org.orgId, saleInput(itemId, registerId, shiftId, 'client-dup')));
    const second = await prisma.$transaction((tx) => postPosSale(tx, org.orgId, saleInput(itemId, registerId, shiftId, 'client-dup')));
    expect(second.posSaleId).toBe(first.posSaleId);
    const count = await prisma.posSale.count({ where: { organizationId: org.orgId, clientSaleId: 'client-dup' } });
    expect(count).toBe(1);
    await cleanupOrg(org.orgId);
  });

  it('rejects a sale when no non-expired batch has enough stock', async () => {
    const { org, itemId, registerId, shiftId } = await setup();
    const tooMany = saleInput(itemId, registerId, shiftId, 'client-oversell');
    tooMany.lines[0].quantity = 10000;
    tooMany.tenders[0].amount = 50000000;
    await expect(prisma.$transaction((tx) => postPosSale(tx, org.orgId, tooMany))).rejects.toThrow(/insufficient|stock/i);
    await cleanupOrg(org.orgId);
  });

  it('rejects a sale when the shift belongs to a different register', async () => {
    const { org, itemId, shiftId } = await setup();
    // A SECOND register in the same org. The open shift from setup() is bound to
    // the FIRST register, so posting against this one must be rejected.
    const secondRegister = await prisma.posRegister.create({
      data: { organizationId: org.orgId, code: 'REG-2', name: 'Register 2', warehouseId: org.warehouseId },
      select: { id: true },
    });
    const input = saleInput(itemId, secondRegister.id, shiftId, 'client-mismatch');
    await expect(prisma.$transaction((tx) => postPosSale(tx, org.orgId, input))).rejects.toThrow(/does not belong/i);
    await cleanupOrg(org.orgId);
  });
});
