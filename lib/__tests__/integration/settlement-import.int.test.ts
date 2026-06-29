/**
 * Integration: settlement reconciliation service (wallet model).
 *
 * Drives `importSettlement` against the real test Postgres DB. Each test first
 * runs ②'s `importMarketplaceOrders` to create a marketplace order + its wallet
 * receipt (the gross X sits in the wallet), then settles it: fees are booked
 * against the wallet, dropping it to the net released N.
 *
 * Asserts: the happy path posts one balanced settlement and stamps the receipt;
 * an unimported order is skipped with nothing posted; and re-settling is an
 * idempotent no-op (GL unchanged).
 *
 * Run with: npx vitest run --config vitest.integration.config.ts \
 *   lib/__tests__/integration/settlement-import.int.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest';
import { importMarketplaceOrders, type ImportOrder } from '../../marketplace-import';
import { importSettlement } from '../../settlement-import';
import { postOpeningStockIfNeeded } from '../../inventory-opening';
import {
  prisma,
  createTestOrg,
  assertTrialBalanced,
  accountBalance,
  cleanupOrg,
  disconnect,
} from './harness';
import type { Prisma } from '@prisma/client';

const SEED_DATE = new Date('2026-01-01T00:00:00.000Z');

afterAll(async () => {
  await disconnect();
});

let seq = 0;
function tag(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

async function createUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `settle-user-${tag()}@test.local`, fullName: 'Settlement User' },
    select: { id: true },
  });
  return u.id;
}

async function createCustomer(orgId: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { organizationId: orgId, code: `C-${tag()}`, name: 'Marketplace Customer' },
    select: { id: true },
  });
  return c.id;
}

/** A BankAccount whose name matches the seeded 'Cash & Bank' GL account so the
 *  wallet resolves to a real GL asset account (same trick as ②'s test). */
async function createWalletBank(orgId: string): Promise<string> {
  const b = await prisma.bankAccount.create({
    data: { organizationId: orgId, name: 'Cash & Bank', bankName: 'Cash & Bank' },
    select: { id: true },
  });
  return b.id;
}

/** A real postable Expense GL account for a fee mapping slot. */
async function createExpenseAccount(orgId: string, code: string, name: string): Promise<string> {
  const a = await prisma.account.create({
    data: {
      organizationId: orgId,
      code,
      name,
      type: 'EXPENSE',
      normalSide: 'DEBIT',
      isActive: true,
      isPostable: true,
    },
    select: { id: true },
  });
  return a.id;
}

/** An active product carrying real on-hand stock (posts opening stock the same
 *  way production does so COGS has a cost layer and the trial balance stays
 *  meaningful). */
async function createStockedItem(orgId: string, unitCost: number, qty: number): Promise<string> {
  let itemId = '';
  await prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        organizationId: orgId,
        sku: `SKU-STK-${tag()}`,
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

interface ImportedOrder {
  orgId: string;
  userId: string;
  connectionId: string;
  /** Gross X of the imported order (invoice total). */
  gross: number;
  walletAccountId: string;
}

/**
 * Seed an org with a wallet bank, fee-account mappings, and a stocked item,
 * then run ②'s import to create order 'ORD1' (invoice + wallet receipt).
 */
async function seedImportedOrder(): Promise<ImportedOrder> {
  const org = await createTestOrg();
  const userId = await createUser();
  const customerId = await createCustomer(org.orgId);
  const bankId = await createWalletBank(org.orgId);
  const exp1 = await createExpenseAccount(org.orgId, `6101-${tag()}`, 'Platform Fee');
  const exp2 = await createExpenseAccount(org.orgId, `6102-${tag()}`, 'Affiliate Fee');
  const exp3 = await createExpenseAccount(org.orgId, `6103-${tag()}`, 'Settlement Adjustment');

  const conn = await prisma.ecommerceConnection.create({
    data: {
      organizationId: org.orgId,
      platform: 'SHOPEE',
      shopName: `Shop-${tag()}`,
      customerId,
      holdingAccountId: bankId,
      mappings: {
        fees: {
          platformFeeAccountId: exp1,
          affiliateFeeAccountId: exp2,
          adjustmentAccountId: exp3,
        },
        shipping: {},
        others: {},
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  const itemId = await createStockedItem(org.orgId, 50_000, 50);

  // Gross X = 5 × 100_000 = 500_000 (tax disabled path: totals = subtotal).
  const order: ImportOrder = {
    orderNo: 'ORD1',
    issueDate: '2026-06-01',
    lines: [
      { itemId, description: 'Stocked Product', sku: 'SKU-STK', quantity: 5, unitPrice: 100_000 },
    ],
  };
  const res = await importMarketplaceOrders(org.orgId, userId, conn.id, [order], {
    recordPayment: true,
  });
  expect(res.created).toBe(1);

  const invoice = await prisma.salesInvoice.findFirst({
    where: { organizationId: org.orgId, poNumber: 'ORD1' },
    select: { totalAmount: true },
  });
  const gross = Number(invoice?.totalAmount ?? 0);

  // Resolve the wallet GL account id (same name-match as production) so we can
  // assert its net balance.
  const walletAcct = await prisma.account.findFirst({
    where: { organizationId: org.orgId, name: 'Cash & Bank' },
    select: { id: true },
  });

  return {
    orgId: org.orgId,
    userId,
    connectionId: conn.id,
    gross,
    walletAccountId: walletAcct!.id,
  };
}

describe('settlement reconciliation service', () => {
  it('happy path: settles ORD1, posts a balanced entry, stamps the receipt', async () => {
    const s = await seedImportedOrder();

    // Wallet currently holds the gross X (②'s receipt debited it).
    expect(await accountBalance(s.orgId, s.walletAccountId)).toBeCloseTo(s.gross, 2);

    const commissionFee = 40_000;
    const serviceFee = 10_000;
    const netReleased = s.gross - commissionFee - serviceFee; // 450_000

    const result = await importSettlement(s.orgId, s.userId, s.connectionId, {
      orders: [{ orderId: 'ORD1', netReleased, charges: { commissionFee, serviceFee } }],
    });

    expect(result.posted).toBe(1);
    expect(result.alreadySettled).toBe(0);
    expect(result.skipped).toHaveLength(0);

    await assertTrialBalanced(s.orgId, 'settlement happy path');

    // The receipt is now stamped settled with a journal link.
    const receipt = await prisma.aRPayment.findFirst({
      where: { organizationId: s.orgId, status: 'COMPLETED' },
      select: { settledAt: true, settlementJournalId: true },
    });
    expect(receipt?.settledAt).toBeTruthy();
    expect(receipt?.settlementJournalId).toBeTruthy();

    // After settlement the wallet's net balance equals the net released.
    expect(await accountBalance(s.orgId, s.walletAccountId)).toBeCloseTo(netReleased, 2);

    await cleanupOrg(s.orgId);
  });

  it('unmatched: an unimported order is skipped and posts nothing', async () => {
    const s = await seedImportedOrder();
    const before = await prisma.journalEntry.count({ where: { organizationId: s.orgId } });

    const result = await importSettlement(s.orgId, s.userId, s.connectionId, {
      orders: [{ orderId: 'NOPE', netReleased: 123_456, charges: { commissionFee: 1000 } }],
    });

    expect(result.posted).toBe(0);
    expect(result.alreadySettled).toBe(0);
    expect(result.skipped).toEqual([{ orderId: 'NOPE', netReleased: 123_456 }]);

    const after = await prisma.journalEntry.count({ where: { organizationId: s.orgId } });
    expect(after).toBe(before);

    // ②'s receipt remains unsettled.
    const receipt = await prisma.aRPayment.findFirst({
      where: { organizationId: s.orgId, status: 'COMPLETED' },
      select: { settledAt: true },
    });
    expect(receipt?.settledAt).toBeNull();

    await cleanupOrg(s.orgId);
  });

  it('idempotent: settling ORD1 twice is a no-op the second time', async () => {
    const s = await seedImportedOrder();
    const commissionFee = 40_000;
    const serviceFee = 10_000;
    const netReleased = s.gross - commissionFee - serviceFee;
    const payload = {
      orders: [{ orderId: 'ORD1', netReleased, charges: { commissionFee, serviceFee } }],
    };

    const first = await importSettlement(s.orgId, s.userId, s.connectionId, payload);
    expect(first.posted).toBe(1);

    const jeAfterFirst = await prisma.journalEntry.count({ where: { organizationId: s.orgId } });
    const walletAfterFirst = await accountBalance(s.orgId, s.walletAccountId);

    const second = await importSettlement(s.orgId, s.userId, s.connectionId, payload);
    expect(second.posted).toBe(0);
    expect(second.alreadySettled).toBe(1);
    expect(second.skipped).toHaveLength(0);

    // No second settlement entry was posted; GL is unchanged.
    const jeAfterSecond = await prisma.journalEntry.count({ where: { organizationId: s.orgId } });
    expect(jeAfterSecond).toBe(jeAfterFirst);
    expect(await accountBalance(s.orgId, s.walletAccountId)).toBeCloseTo(walletAfterFirst, 2);

    await assertTrialBalanced(s.orgId, 'settlement idempotent');
    await cleanupOrg(s.orgId);
  });
});
