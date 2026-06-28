import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    customer: {
      findFirst: vi.fn(),
    },
    item: {
      findFirst: vi.fn(),
    },
    warehouse: {
      findFirst: vi.fn(),
    },
    salesOrder: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    stockAdjustment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    stockAdjustmentLine: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    bankAccount: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    bankTransaction: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  return { prisma };
});

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    nextNumber: vi.fn(async () => 'ADJ-0001'),
    logAudit: vi.fn(),
  };
});

// The edit handler delegates its GL + cached-balance work to the posting lib
// (reverse the old entry, re-post the new one). Mock that boundary so these unit
// tests verify the handler's orchestration; the real posting math is covered by
// lib/__tests__/integration/bank-transaction-edit-repost.int.test.ts.
vi.mock('@/lib/bank-transaction-posting', () => ({
  reverseBankTransactionPosting: vi.fn(),
  postBankTransactionIfNeeded: vi.fn(),
  postBankOpeningBalance: vi.fn(),
}));

vi.mock('@/lib/credit-limit', () => ({
  calculateSalesOrderTotal: vi.fn((items: Array<{ quantity?: number; price?: number; discount?: number }>) =>
    items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.price || 0)), 0)),
  CreditLimitError: class CreditLimitError extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  },
  enforceCustomerCreditLimit: vi.fn(async () => undefined),
}));

import { prisma } from '@/lib/prisma';
import { POST as createSalesOrder } from '../sales-orders/route';
import { POST as createStockAdjustment } from '../stock-adjustments/route';
import { DELETE as deleteBankTransaction } from '../bank-transactions/[id]/route';
import { PUT as updateBankTransaction } from '../bank-transactions/[id]/route';
import { reverseBankTransactionPosting, postBankTransactionIfNeeded } from '@/lib/bank-transaction-posting';

function makeReq(path: string, orgId: string, method = 'GET', body?: unknown) {
  const init = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1', 'x-role-type': 'ADMIN' } } as any;
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost${path}`, init);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('operational route validation', () => {
  it('rejects invalid sales order payloads before writing', async () => {
    const res = await createSalesOrder(makeReq('/api/v1/sales-orders', 'org-a', 'POST', {
      customerName: '',
      items: [{ description: '', quantity: 1, price: 100 }],
    }));

    expect(res.status).toBe(400);
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
  });

  it('rejects stock adjustments when an item is not found in the organization', async () => {
    vi.mocked(prisma.item.findFirst).mockResolvedValue(null);

    const res = await createStockAdjustment(makeReq('/api/v1/stock-adjustments', 'org-a', 'POST', {
      date: '2026-04-06',
      type: 'QUANTITY',
      reason: 'Cycle count',
      lines: [{ itemId: 'missing-item', oldQty: 5, newQty: 3, unitCost: 10 }],
    }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Item not found in organization' });
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('backs out the old posting then re-posts when a transaction amount changes', async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue({
      id: 'txn-1',
      bankAccountId: 'bank-1',
      type: 'EXPENSE',
      amount: 100,
      journalEntryId: 'je-1',
    } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({ id: 'txn-1' } as never);
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'bank-1' } as never);
    // Reverse undoes the original −100 expense; the re-post applies the new −150.
    vi.mocked(reverseBankTransactionPosting).mockResolvedValue([{ bankAccountId: 'bank-1', delta: 100 }]);
    vi.mocked(postBankTransactionIfNeeded).mockResolvedValue({
      journalEntryId: 'je-2',
      moves: [{ bankAccountId: 'bank-1', delta: -150 }],
    });

    const res = await updateBankTransaction(makeReq('/api/v1/bank-transactions/txn-1', 'org-a', 'PUT', {
      amount: 150,
      type: 'EXPENSE',
    }), params('txn-1'));

    expect(res.status).toBe(200);
    // Clears journalEntryId so the re-post is not treated as already-posted.
    expect(prisma.bankTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'txn-1', organizationId: 'org-a' },
      data: expect.objectContaining({ journalEntryId: null }),
    }));
    // Back out the old cached effect (+100), then apply the re-posted one (−150).
    expect(prisma.bankAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'bank-1' },
      data: { currentBalance: { increment: 100 } },
    });
    expect(prisma.bankAccount.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'bank-1' },
      data: { currentBalance: { increment: -150 } },
    });
  });

  it('moves the cached balance from the old account to the new one on reassignment', async () => {
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: 'bank-2' } as never);
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue({
      id: 'txn-1',
      bankAccountId: 'bank-1',
      type: 'INCOME',
      amount: 100,
      journalEntryId: 'je-1',
    } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({ id: 'txn-1' } as never);
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'bank-1' } as never);
    // Reverse backs the +100 income out of the old account; the re-post lands it
    // on the reassigned account.
    vi.mocked(reverseBankTransactionPosting).mockResolvedValue([{ bankAccountId: 'bank-1', delta: -100 }]);
    vi.mocked(postBankTransactionIfNeeded).mockResolvedValue({
      journalEntryId: 'je-2',
      moves: [{ bankAccountId: 'bank-2', delta: 100 }],
    });

    const res = await updateBankTransaction(makeReq('/api/v1/bank-transactions/txn-1', 'org-a', 'PUT', {
      bankAccountId: 'bank-2',
      amount: 100,
      type: 'INCOME',
    }), params('txn-1'));

    expect(res.status).toBe(200);
    expect(prisma.bankAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'bank-1' },
      data: { currentBalance: { increment: -100 } },
    });
    expect(prisma.bankAccount.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'bank-2' },
      data: { currentBalance: { increment: 100 } },
    });
  });

  it('reverses the bank balance effect when deleting an expense transaction', async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue({
      id: 'txn-1',
      bankAccountId: 'bank-1',
      type: 'EXPENSE',
      amount: 100,
    } as never);
    // The delete is now claimed atomically via deleteMany (guarded by
    // journalEntryId: null) BEFORE the balance is adjusted, so a concurrent
    // double-delete cannot double-increment the balance.
    vi.mocked(prisma.bankTransaction.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'bank-1' } as never);

    const res = await deleteBankTransaction(
      makeReq('/api/v1/bank-transactions/txn-1', 'org-a', 'DELETE'),
      params('txn-1'),
    );

    expect(res.status).toBe(200);
    expect(prisma.bankTransaction.deleteMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', organizationId: 'org-a', journalEntryId: null },
    });
    expect(prisma.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'bank-1' },
      data: { currentBalance: { increment: 100 } },
    });
  });
});
