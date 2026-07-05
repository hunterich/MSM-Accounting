/**
 * Integration: marketplace import orchestrator.
 *
 * Drives `importMarketplaceOrders` against the real test Postgres DB, asserting
 * the end-to-end accounting outcome: a marketplace order becomes a PAID,
 * fully-GL-posted SalesInvoice (revenue + COGS + settlement receipt), the import
 * is idempotent by poNumber, an inactive item rejects the whole order, and a
 * zero-stock item still imports (negative stock allowed for imports).
 *
 * Run with: npm run test:int
 */
import { afterAll, describe, expect, it } from 'vitest';
import { importMarketplaceOrders, type ImportOrder } from '../../marketplace-import';
import { postOpeningStockIfNeeded } from '../../inventory-opening';
import {
  prisma,
  createTestOrg,
  assertTrialBalanced,
  cleanupOrg,
  disconnect,
  type TestOrg,
} from './harness';

const SEED_DATE = new Date('2026-01-01T00:00:00.000Z');

afterAll(async () => {
  await disconnect();
});

let userSeq = 0;
async function createUser(): Promise<string> {
  userSeq += 1;
  const u = await prisma.user.create({
    data: {
      email: `import-user-${Date.now()}-${userSeq}@test.local`,
      fullName: 'Import User',
    },
    select: { id: true },
  });
  return u.id;
}

async function createCustomer(orgId: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { organizationId: orgId, code: `C-${Date.now()}-${userSeq}`, name: 'Marketplace Customer' },
    select: { id: true },
  });
  return c.id;
}

/** A bank account whose name matches the seeded 'Cash & Bank' GL account so the
 *  settlement receipt resolves to a real GL asset account. */
async function createSettlementBank(orgId: string): Promise<string> {
  const b = await prisma.bankAccount.create({
    data: { organizationId: orgId, name: 'Cash & Bank', bankName: 'Cash & Bank' },
    select: { id: true },
  });
  return b.id;
}

async function createConnection(
  orgId: string,
  customerId: string,
  holdingAccountId: string,
): Promise<string> {
  const conn = await prisma.ecommerceConnection.create({
    data: {
      organizationId: orgId,
      platform: 'SHOPEE',
      shopName: `Shop-${Date.now()}-${userSeq}`,
      customerId,
      holdingAccountId,
    },
    select: { id: true },
  });
  return conn.id;
}

/** An active product carrying real on-hand stock. Posts opening stock the same
 *  way production does (creates the lot + balanced opening JE), so COGS has a
 *  cost layer to consume and the trial balance stays meaningful. */
async function createStockedItem(orgId: string, unitCost: number, qty: number): Promise<string> {
  let itemId = '';
  await prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        sku: `SKU-STK-${Date.now()}-${userSeq}`,
        name: 'Stocked Product',
        type: 'PRODUCT',
        unit: 'PCS',
        sellingPrice: unitCost * 2,
        costPrice: unitCost,
        openingStock: qty,
        isActive: true,
      },
      select: { id: true },
    });
    itemId = item.id;
    await postOpeningStockIfNeeded(tx, orgId, item.id, SEED_DATE);
  });
  return itemId;
}

async function createInactiveItem(orgId: string): Promise<string> {
  const item = await prisma.item.create({
    data: {
      organizationId: orgId,
      sku: `SKU-INA-${Date.now()}-${userSeq}`,
      name: 'Discontinued Product',
      type: 'PRODUCT',
      unit: 'PCS',
      sellingPrice: 1000,
      costPrice: 500,
      isActive: false,
    },
    select: { id: true },
  });
  return item.id;
}

async function createZeroStockItem(orgId: string): Promise<string> {
  const item = await prisma.item.create({
    data: {
      organizationId: orgId,
      sku: `SKU-ZERO-${Date.now()}-${userSeq}`,
      name: 'New Imported Product',
      type: 'PRODUCT',
      unit: 'PCS',
      sellingPrice: 50_000,
      costPrice: 0,
      openingStock: 0,
      isActive: true,
    },
    select: { id: true },
  });
  return item.id;
}

interface Scenario {
  org: TestOrg;
  userId: string;
  customerId: string;
  connectionId: string;
}

async function seedScenario(): Promise<Scenario> {
  const org = await createTestOrg();
  const userId = await createUser();
  const customerId = await createCustomer(org.orgId);
  const bankId = await createSettlementBank(org.orgId);
  const connectionId = await createConnection(org.orgId, customerId, bankId);
  return { org, userId, customerId, connectionId };
}

describe('marketplace import orchestrator', () => {
  it('happy path: imports an order to a PAID, GL-balanced invoice', async () => {
    const s = await seedScenario();
    const itemId = await createStockedItem(s.org.orgId, 100_000, 10);

    const order: ImportOrder = {
      orderNo: 'ORDER-HAPPY-1',
      issueDate: '2026-06-01',
      lines: [{ itemId, description: 'Stocked Product', sku: 'SKU-STK', quantity: 2, unitPrice: 250_000 }],
    };

    const result = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], {
      recordPayment: true,
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);

    const invoice = await prisma.salesInvoice.findFirst({
      where: { organizationId: s.org.orgId, poNumber: 'ORDER-HAPPY-1' },
      select: { status: true },
    });
    expect(invoice?.status).toBe('PAID');

    // Settlement receipt exists and posted GL.
    const payment = await prisma.aRPayment.findFirst({
      where: { organizationId: s.org.orgId, customerId: s.customerId, status: 'COMPLETED' },
      select: { journalEntryId: true },
    });
    expect(payment?.journalEntryId).toBeTruthy();

    // The org-wide GL must balance (revenue + COGS + receipt all net to zero).
    await assertTrialBalanced(s.org.orgId, 'marketplace happy path');

    await cleanupOrg(s.org.orgId);
  });

  it('idempotent: re-importing the same order skips and creates no duplicate', async () => {
    const s = await seedScenario();
    const itemId = await createStockedItem(s.org.orgId, 80_000, 20);

    const order: ImportOrder = {
      orderNo: 'ORDER-DUP-1',
      issueDate: '2026-06-02',
      lines: [{ itemId, description: 'Stocked Product', sku: 'SKU-STK', quantity: 1, unitPrice: 150_000 }],
    };

    const first = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], {
      recordPayment: true,
    });
    expect(first.created).toBe(1);

    const second = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], {
      recordPayment: true,
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);

    const invoices = await prisma.salesInvoice.findMany({
      where: { organizationId: s.org.orgId, poNumber: 'ORDER-DUP-1' },
    });
    expect(invoices).toHaveLength(1);

    await assertTrialBalanced(s.org.orgId, 'marketplace idempotent');
    await cleanupOrg(s.org.orgId);
  });

  it('inactive guard: rejects the order with the inactive item, imports the good one', async () => {
    const s = await seedScenario();
    const goodItemId = await createStockedItem(s.org.orgId, 60_000, 5);
    const badItemId = await createInactiveItem(s.org.orgId);

    const badOrder: ImportOrder = {
      orderNo: 'BAD',
      issueDate: '2026-06-03',
      lines: [{ itemId: badItemId, description: 'Discontinued', sku: 'SKU-INA', quantity: 1, unitPrice: 1000 }],
    };
    const goodOrder: ImportOrder = {
      orderNo: 'GOOD',
      issueDate: '2026-06-03',
      lines: [{ itemId: goodItemId, description: 'Stocked Product', sku: 'SKU-STK', quantity: 1, unitPrice: 120_000 }],
    };

    const result = await importMarketplaceOrders(
      s.org.orgId,
      s.userId,
      s.connectionId,
      [badOrder, goodOrder],
      { recordPayment: true },
    );

    expect(result.created).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].orderNo).toBe('BAD');
    expect(result.failed[0].reason).toMatch(/inactive/i);

    // No invoice was created for the rejected order.
    const badInvoice = await prisma.salesInvoice.findFirst({
      where: { organizationId: s.org.orgId, poNumber: 'BAD' },
      select: { id: true },
    });
    expect(badInvoice).toBeNull();

    // The good order imported fine.
    const goodInvoice = await prisma.salesInvoice.findFirst({
      where: { organizationId: s.org.orgId, poNumber: 'GOOD' },
      select: { status: true },
    });
    expect(goodInvoice?.status).toBe('PAID');

    await assertTrialBalanced(s.org.orgId, 'marketplace inactive guard');
    await cleanupOrg(s.org.orgId);
  });

  it('zero-stock new item: imports despite no on-hand stock (negative stock allowed)', async () => {
    const s = await seedScenario();
    const itemId = await createZeroStockItem(s.org.orgId);

    const order: ImportOrder = {
      orderNo: 'ORDER-ZERO-1',
      issueDate: '2026-06-04',
      lines: [{ itemId, description: 'New Imported Product', sku: 'SKU-ZERO', quantity: 3, unitPrice: 75_000 }],
    };

    const result = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], {
      recordPayment: true,
    });

    expect(result.created).toBe(1);
    expect(result.failed).toHaveLength(0);

    const invoice = await prisma.salesInvoice.findFirst({
      where: { organizationId: s.org.orgId, poNumber: 'ORDER-ZERO-1' },
      select: { status: true },
    });
    expect(invoice?.status).toBe('PAID');

    await assertTrialBalanced(s.org.orgId, 'marketplace zero-stock');
    await cleanupOrg(s.org.orgId);
  });
});
