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
import { previewMarketplaceOrders, type PreviewOrder } from '../../marketplace-import-preview';
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

/** A connection whose imported invoices should be stamped with a sales type. */
async function createConnectionWithSalesType(
  orgId: string,
  customerId: string,
  holdingAccountId: string,
  salesTypeId: string,
): Promise<string> {
  const conn = await prisma.ecommerceConnection.create({
    data: {
      organizationId: orgId,
      platform: 'SHOPEE',
      shopName: `Shop-ST-${Date.now()}-${userSeq}`,
      customerId,
      holdingAccountId,
      salesTypeId,
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

  it('posts stock and revenue in the shipment month and does not repost on completion', async () => {
    const s = await seedScenario();
    try {
      const itemId = await createStockedItem(s.org.orgId, 50_000, 10);
      const order: ImportOrder = { orderNo: 'MONTH-END', issueDate: '2026-02-04', shipmentDate: '2026-01-31', orderStatus: 'Shipped',
        lines: [{ itemId, description: 'Product', sku: 'STK', quantity: 1, unitPrice: 100_000 }] };
      expect((await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], { recordPayment: true })).failed).toEqual([]);
      const invoice = await prisma.salesInvoice.findFirstOrThrow({ where: { organizationId: s.org.orgId, poNumber: order.orderNo } });
      expect(invoice.issueDate.toISOString().slice(0, 10)).toBe('2026-01-31');
      const ledger = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: s.org.orgId, documentId: invoice.id } });
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].qtyOut)).toBe(1);
      expect(ledger[0].date.toISOString().slice(0, 10)).toBe('2026-01-31');
      const journals = await prisma.journalEntry.findMany({ where: { id: { in: invoice.postingJournalIds } } });
      expect(journals.length).toBeGreaterThanOrEqual(2);
      expect(journals.every(j => j.date.toISOString().slice(0, 10) === '2026-01-31')).toBe(true);
      const before = await prisma.journalEntry.count({ where: { organizationId: s.org.orgId } });
      const repeat = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [{ ...order, orderStatus: 'Completed' }], { recordPayment: true });
      expect(repeat.skipped).toBe(1);
      expect(await prisma.journalEntry.count({ where: { organizationId: s.org.orgId } })).toBe(before);
      await assertTrialBalanced(s.org.orgId, 'shipment-month recognition');
    } finally { await cleanupOrg(s.org.orgId); }
  });

  it('does not book an unshipped cancellation and flags a shipped cancellation for a linked return', async () => {
    const s = await seedScenario();
    try {
      const itemId = await createStockedItem(s.org.orgId, 50_000, 10);
      const order: ImportOrder = { orderNo: 'CANCELLED', issueDate: '2026-06-01', orderStatus: 'Cancelled',
        lines: [{ itemId, description: 'Product', sku: 'STK', quantity: 1, unitPrice: 100_000 }] };
      const cancelled = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], { recordPayment: true });
      expect(cancelled.skipped).toBe(1);
      expect(await prisma.salesInvoice.count({ where: { organizationId: s.org.orgId } })).toBe(0);
      await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [{ ...order, orderStatus: 'Shipped' }], { recordPayment: true });
      const before = await prisma.journalEntry.count({ where: { organizationId: s.org.orgId } });
      const afterShipment = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], { recordPayment: true });
      expect(afterShipment.failed[0].reason).toContain('linked sales return');
      expect(await prisma.journalEntry.count({ where: { organizationId: s.org.orgId } })).toBe(before);
    } finally { await cleanupOrg(s.org.orgId); }
  });

  it('never posts a new sale or mutates an existing one on secondary return evidence', async () => {
    const s = await seedScenario();
    try {
      const itemId = await createStockedItem(s.org.orgId, 50_000, 10);
      const order: ImportOrder = { orderNo: 'SHIPPED-ORIGINAL', issueDate: '2026-06-01', shipmentDate: '2026-06-01', orderStatus: 'Telah Dikirim',
        lines: [{ itemId, description: 'Product', sku: 'STK', quantity: 1, unitPrice: 100_000 }] };
      const original = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], { recordPayment: true });
      expect(original.created).toBe(1);
      const counts = () => {
        const where = { organizationId: s.org.orgId };
        return Promise.all([
          prisma.salesInvoice.count({ where }),
          prisma.aRPayment.count({ where }),
          prisma.inventoryLedgerEntry.count({ where }),
          prisma.journalEntry.count({ where }),
          prisma.salesReturn.count({ where }),
          prisma.creditNote.count({ where }),
        ]);
      };
      const before = await counts();
      const review = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [
        { ...order, orderStatus: 'Selesai', requiresReturnReview: true, trackingNumber: 'NEVER-WRITTEN' },
        { ...order, orderNo: 'SHIPPED-RETURN', requiresReturnReview: true },
      ], { recordPayment: true });
      expect(review.created).toBe(0);
      expect(review.logisticsUpdated).toBe(0);
      expect(review.failed.map(row => row.orderNo)).toEqual(['SHIPPED-ORIGINAL', 'SHIPPED-RETURN']);
      expect(await counts()).toEqual(before);
      expect((await prisma.salesInvoice.findFirstOrThrow({ where: { organizationId: s.org.orgId } })).trackingNumber).toBeNull();
    } finally { await cleanupOrg(s.org.orgId); }
  });

  it.each(['Saldo Shopee', 'Shopee Wallet'])('settles into the mapped non-default holding asset %s', async name => {
    const s = await seedScenario();
    try {
      const holding = await prisma.account.create({ data: { organizationId: s.org.orgId, code: '1195', name, type: 'ASSET', normalSide: 'DEBIT' } });
      const bank = await prisma.bankAccount.create({ data: { organizationId: s.org.orgId, name, bankName: name } });
      await prisma.ecommerceConnection.update({ where: { id: s.connectionId }, data: { holdingAccountId: bank.id } });
      const itemId = await createStockedItem(s.org.orgId, 50_000, 10);
      const order: ImportOrder = { orderNo: 'WALLET-ORDER', issueDate: '2026-06-01',
        lines: [{ itemId, description: 'Stocked Product', sku: 'STK', quantity: 1, unitPrice: 100_000 }] };
      const result = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], { recordPayment: true });
      expect(result.failed).toEqual([]);
      expect(result.created).toBe(1);
      const invoice = await prisma.salesInvoice.findFirstOrThrow({ where: { organizationId: s.org.orgId, poNumber: order.orderNo } });
      expect(invoice.status).toBe('PAID');
      const payment = await prisma.aRPayment.findFirstOrThrow({ where: { organizationId: s.org.orgId } });
      expect(payment.depositAccountId).toBe(holding.id);
      expect(await prisma.journalLine.count({ where: { entryId: payment.journalEntryId!, accountId: holding.id, debit: invoice.totalAmount } })).toBe(1);
      const count = await prisma.journalEntry.count({ where: { organizationId: s.org.orgId } });
      const replay = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [order], { recordPayment: true });
      expect(replay.skipped).toBe(1);
      expect(await prisma.journalEntry.count({ where: { organizationId: s.org.orgId } })).toBe(count);
      await assertTrialBalanced(s.org.orgId, 'marketplace wallet');
    } finally { await cleanupOrg(s.org.orgId); }
  });

  it('reviews existing, new, inactive, and undated orders without posting them', async () => {
    const s = await seedScenario();
    const activeItemId = await createStockedItem(s.org.orgId, 25_000, 10);
    const inactiveItemId = await createInactiveItem(s.org.orgId);
    const existing: ImportOrder = {
      orderNo: 'REVIEW-EXISTING', issueDate: '2026-06-01',
      lines: [{ itemId: activeItemId, description: 'Stocked Product', sku: 'STK', quantity: 1, unitPrice: 100_000 }],
    };
    await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [existing], { recordPayment: false });

    const orders: PreviewOrder[] = [
      { ...existing, sourceTotal: 100_000, missingDate: false },
      {
        orderNo: 'REVIEW-NEW', issueDate: '2026-06-02', sourceTotal: 100_000, missingDate: false,
        lines: [{ itemId: activeItemId, description: 'Stocked Product', sku: 'STK', quantity: 1, unitPrice: 100_000 }],
      },
      {
        orderNo: 'REVIEW-INACTIVE', issueDate: '2026-06-02', sourceTotal: 1_000, missingDate: false,
        lines: [{ itemId: inactiveItemId, description: 'Inactive Product', sku: 'INA', quantity: 1, unitPrice: 1_000 }],
      },
      {
        orderNo: 'REVIEW-NO-DATE', issueDate: '2026-06-02', sourceTotal: 1_000, missingDate: true,
        lines: [{ itemId: activeItemId, description: 'Stocked Product', sku: 'STK', quantity: 1, unitPrice: 1_000 }],
      },
    ];
    const preview = await previewMarketplaceOrders(s.org.orgId, s.connectionId, orders, { recordPayment: true });
    expect(preview.create).toBe(1);
    expect(preview.alreadyImported).toBe(1);
    expect(preview.blocked).toBe(2);
    expect(preview.amountDifferences).toBe(1);
    expect(preview.orders[1].invoiceTotal).toBe(111_000);
    expect(preview.orders[1].difference).toBe(11_000);
    expect(preview.orders[2].reason).toMatch(/inactive/i);
    expect(preview.orders[3].reason).toMatch(/date/i);
    expect(await prisma.salesInvoice.count({ where: { organizationId: s.org.orgId } })).toBe(1);

    await prisma.ecommerceConnection.update({ where: { id: s.connectionId }, data: { holdingAccountId: null } });
    const noAccount = await previewMarketplaceOrders(s.org.orgId, s.connectionId, orders, { recordPayment: true });
    expect(noAccount.paymentAccountMissing).toBe(true);
    expect(noAccount.setupErrors).toHaveLength(1);
    await expect(importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [existing], { recordPayment: true }))
      .rejects.toThrow(/holding account/i);

    await cleanupOrg(s.org.orgId);
  });

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

    const enrichedOrder = {
      ...order,
      trackingNumber: 'JX1234567890',
      shippingCarrier: 'J&T Express',
      shippingAddress: 'Surabaya',
    };
    const second = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [enrichedOrder], {
      recordPayment: true,
    });
    expect(second.created).toBe(0);
    expect(second.logisticsUpdated).toBe(1);
    expect(second.skipped).toBe(0);

    const third = await importMarketplaceOrders(s.org.orgId, s.userId, s.connectionId, [enrichedOrder], {
      recordPayment: true,
    });
    expect(third.skipped).toBe(1);

    const invoices = await prisma.salesInvoice.findMany({
      where: { organizationId: s.org.orgId, poNumber: 'ORDER-DUP-1' },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      trackingNumber: 'JX1234567890', shippingCarrier: 'J&T Express', shippingAddress: 'Surabaya',
    });

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

  it('stamps the connection sales type onto every imported invoice', async () => {
    const org = await createTestOrg();
    const userId = await createUser();
    const customerId = await createCustomer(org.orgId);
    const bankId = await createSettlementBank(org.orgId);
    const salesType = await prisma.salesType.create({
      data: { organizationId: org.orgId, name: 'Shopee', channel: 'ONLINE' },
      select: { id: true },
    });
    const connectionId = await createConnectionWithSalesType(org.orgId, customerId, bankId, salesType.id);
    const itemId = await createStockedItem(org.orgId, 50_000, 10);

    const order: ImportOrder = {
      orderNo: 'ORDER-ST-1',
      issueDate: '2026-06-05',
      lines: [{ itemId, description: 'Stocked Product', sku: 'SKU-STK', quantity: 2, unitPrice: 100_000 }],
    };

    const result = await importMarketplaceOrders(org.orgId, userId, connectionId, [order], {
      recordPayment: true,
    });
    expect(result.created).toBe(1);
    expect(result.failed).toHaveLength(0);

    const invoice = await prisma.salesInvoice.findFirst({
      where: { organizationId: org.orgId, poNumber: 'ORDER-ST-1' },
      select: { salesTypeId: true },
    });
    expect(invoice?.salesTypeId).toBe(salesType.id);

    await assertTrialBalanced(org.orgId, 'marketplace sales-type stamp');
    await cleanupOrg(org.orgId);
  });
});
