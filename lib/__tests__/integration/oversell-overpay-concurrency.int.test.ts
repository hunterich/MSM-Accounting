/**
 * Concurrency regression tests for two money-losing races:
 *
 *   C-2 — Inventory oversell. getAvailableQty / the FEFO pick read on-hand with
 *   a plain findMany and consumeFIFO / the batch decrement then apply a RELATIVE
 *   decrement. Under READ COMMITTED, two concurrent sales of the same item both
 *   pass the sufficiency check against the same on-hand and both draw stock
 *   below zero. The fix takes a per-item transaction-scoped advisory lock
 *   (`pg_advisory_xact_lock(advisoryLockKey('item-stock:'+orgId+':'+itemId))`)
 *   at the top of BOTH outbound consumption paths (calculateAndPostCOGS/
 *   consumeFIFO for the invoice-send COGS path, and the POS FEFO pick), so the
 *   loser blocks, re-reads the winner's committed balance, and correctly fails.
 *
 *   H-3 — Payment over-application. The AR-payment route aggregates COMPLETED
 *   allocations, computes outstanding, and rejects an over-apply — but never
 *   locked the invoice, so two concurrent payments both saw the same outstanding
 *   and both posted (160 applied to a 100 invoice). The fix takes `SELECT id ...
 *   FOR UPDATE` on the target invoice before the aggregate, so the loser blocks
 *   and re-reads the committed allocation.
 *
 *   H-4 — Void-while-paying. The route's invoice lookup had no status filter, so
 *   a payment could be applied to a VOID/DRAFT/PENDING_APPROVAL invoice. The fix
 *   re-reads status UNDER the FOR UPDATE lock and rejects with a clean 4xx.
 *
 * Run with:  npm run test:int -- oversell-overpay-concurrency
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { InventoryDocumentType } from '@prisma/client';
import { addCostLayer, calculateAndPostCOGS } from '@/lib/inventory-costing';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { postPosSale, type PosSaleInput } from '@/lib/pos/sale-posting';
import { POST as postArPaymentRoute } from '@/src/app/api/v1/ar-payments/route';
import {
  prisma,
  createTestOrg,
  createCustomer,
  createItem,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

/** Seed a real User so the route's fire-and-forget audit log resolves its FK. */
async function seedUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `u-${randomUUID()}@test.local`, fullName: 'Concurrency Tester', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true },
  });
  return user.id;
}

/* ------------------------------------------------------------------ */
/* C-2 — inventory oversell                                            */
/* ------------------------------------------------------------------ */

describe('C-2: concurrent sales cannot oversell (invoice-send COGS / FIFO lot path)', () => {
  it('two concurrent COGS draws of the full on-hand → one wins, one fails, stock never goes negative', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const itemId = await createItem(org.orgId, 100);

    // Exactly 5 units on hand.
    await prisma.$transaction((tx) =>
      addCostLayer(tx, org.orgId, itemId, null, 5, 100, InventoryDocumentType.PURCHASE, 'grn-1', new Date('2026-07-01')),
    );

    const consume = (docId: string) =>
      prisma.$transaction((tx) =>
        calculateAndPostCOGS(tx, org.orgId, itemId, null, 5, InventoryDocumentType.SALES, docId, new Date('2026-07-05')),
      );

    // Both attempt to draw the entire 5-unit balance at once.
    const results = await Promise.allSettled([consume('sale-a'), consume('sale-b')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/insufficient|stock/i);

    // The winner drew on-hand to exactly 0 — never below.
    const lots = await prisma.inventoryLot.findMany({
      where: { organizationId: org.orgId, itemId },
      select: { qtyBalance: true },
    });
    const onHand = lots.reduce((s, l) => s + Number(l.qtyBalance), 0);
    expect(onHand).toBe(0);
    expect(onHand).toBeGreaterThanOrEqual(0);

    // Exactly one outbound SALES movement (the loser's transaction rolled back).
    const outbound = await prisma.inventoryLedgerEntry.count({
      where: { organizationId: org.orgId, itemId, documentType: InventoryDocumentType.SALES },
    });
    expect(outbound).toBe(1);

    await cleanupOrg(org.orgId);
  });
});

describe('C-2: concurrent POS sales cannot oversell (FEFO batch path)', () => {
  it('two concurrent POS sales of the full batch → one wins, one fails, batch never goes negative', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    // POS posting needs a COGS + output-tax account and a walk-in customer.
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
    await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in Customer' } });
    const item = await prisma.item.create({
      data: {
        organizationId: org.orgId, sku: `SKU-${randomUUID().slice(0, 8)}`, name: 'Paracetamol 500mg',
        type: 'PRODUCT', sellingPrice: 5000, costPrice: 2000, requiresBatchTracking: true, drugClass: 'OBAT_BEBAS',
      },
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
    // Exactly 5 units on hand, one batch.
    await prisma.$transaction((tx) =>
      receiveBatch(tx, org.orgId, {
        itemId: item.id, warehouseId: org.warehouseId, batchNumber: 'B1',
        expiryDate: new Date('2027-10-01'), qty: 5, unitCost: 2000, date: new Date('2026-07-01'),
      }),
    );

    const sale = (clientSaleId: string): PosSaleInput => ({
      clientSaleId,
      registerId: register.id,
      shiftId: shift.id,
      cashierId: 'user-cashier',
      warehouseId: null,
      lines: [{ itemId: item.id, description: 'Paracetamol 500mg', quantity: 5, price: 5000, discountPct: 0 }],
      tenders: [{ method: 'CASH', amount: 25000 }],
      date: new Date('2026-07-05'),
    });

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => postPosSale(tx, org.orgId, sale('pos-a'))),
      prisma.$transaction((tx) => postPosSale(tx, org.orgId, sale('pos-b'))),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/insufficient|stock/i);

    // The winner drew the batch to exactly 0 — never below.
    const batch = await prisma.stockBatch.findFirst({
      where: { organizationId: org.orgId, itemId: item.id, batchNumber: 'B1' },
      select: { qtyOnHand: true },
    });
    expect(Number(batch?.qtyOnHand)).toBe(0);

    // Exactly one POS sale persisted (the loser rolled back).
    const posSaleCount = await prisma.posSale.count({ where: { organizationId: org.orgId } });
    expect(posSaleCount).toBe(1);

    await cleanupOrg(org.orgId);
  });
});

/* ------------------------------------------------------------------ */
/* H-3 / H-4 — AR payment over-application + void-while-paying         */
/* ------------------------------------------------------------------ */

/** Build a NextRequest carrying the identity headers the route reads (actor is ADMIN). */
function authedPost(orgId: string, userId: string, body: unknown): NextRequest {
  return new NextRequest(new URL('/api/v1/ar-payments', 'http://localhost'), {
    method: 'POST',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': userId,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  });
}

async function seedSentInvoice(orgId: string, customerId: string, total: number, status: 'SENT' | 'VOID') {
  return prisma.salesInvoice.create({
    data: {
      organizationId: orgId,
      number: `INV-${randomUUID().slice(0, 8)}`,
      customerId,
      issueDate: new Date('2026-07-01'),
      status,
      taxEnabled: false,
      subtotal: total,
      totalAmount: total,
      taxAmount: 0,
    },
    select: { id: true },
  });
}

describe('H-3: concurrent AR payments cannot exceed the invoice total', () => {
  it('two concurrent full payments against a 1000 invoice → one 201, one 422, only 1000 applied', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    const customerId = await createCustomer(org.orgId);
    const inv = await seedSentInvoice(org.orgId, customerId, 1000, 'SENT');

    const body = {
      customerId,
      date: '2026-07-05',
      method: 'CASH',
      status: 'COMPLETED',
      totalAmount: 1000,
      depositAccountId: org.accounts.bankAsset,
      arAccountId: org.accounts.arControl,
      allocations: [{ invoiceId: inv.id, amountApplied: 1000 }],
    };

    // Handlers resolve to a NextResponse (never reject); tally by status.
    const [res1, res2] = await Promise.all([
      postArPaymentRoute(authedPost(org.orgId, userId, body)),
      postArPaymentRoute(authedPost(org.orgId, userId, body)),
    ]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 422]);

    // The loser surfaced the over-allocation error.
    const loser = res1.status === 422 ? res1 : res2;
    const loserBody = (await loser.json()) as { error: string };
    expect(loserBody.error).toMatch(/over-allocation/i);

    // THE load-bearing assertion: exactly 1000 cleared the invoice, never 2000.
    const applied = await prisma.aRPaymentAllocation.aggregate({
      where: { invoiceId: inv.id, payment: { status: 'COMPLETED' } },
      _sum: { amountApplied: true },
    });
    expect(Number(applied._sum.amountApplied ?? 0)).toBe(1000);

    // Exactly one COMPLETED payment persisted.
    const completed = await prisma.aRPayment.count({ where: { organizationId: org.orgId, status: 'COMPLETED' } });
    expect(completed).toBe(1);

    await cleanupOrg(org.orgId);
  });
});

describe('H-4: a payment cannot be applied to a non-payable invoice', () => {
  it('applying a payment to a VOID invoice is rejected with 422 and posts nothing', async () => {
    const org = await createTestOrg();
    const userId = await seedUser();
    const customerId = await createCustomer(org.orgId);
    const inv = await seedSentInvoice(org.orgId, customerId, 1000, 'VOID');

    const res = await postArPaymentRoute(
      authedPost(org.orgId, userId, {
        customerId,
        date: '2026-07-05',
        method: 'CASH',
        status: 'COMPLETED',
        totalAmount: 500,
        depositAccountId: org.accounts.bankAsset,
        arAccountId: org.accounts.arControl,
        allocations: [{ invoiceId: inv.id, amountApplied: 500 }],
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/void/i);

    // No payment persisted.
    const count = await prisma.aRPayment.count({ where: { organizationId: org.orgId } });
    expect(count).toBe(0);

    await cleanupOrg(org.orgId);
  });
});
