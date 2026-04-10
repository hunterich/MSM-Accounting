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

function makeReq(path: string, orgId: string, method = 'GET', body?: unknown) {
  const init = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1' } } as any;
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

  it('rebalances bank account totals when a transaction amount changes on the same account', async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue({
      id: 'txn-1',
      bankAccountId: 'bank-1',
      type: 'EXPENSE',
      amount: 100,
    } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({
      id: 'txn-1',
      bankAccount: { id: 'bank-1', name: 'Main Bank' },
    } as never);
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'bank-1' } as never);

    const res = await updateBankTransaction(makeReq('/api/v1/bank-transactions/txn-1', 'org-a', 'PUT', {
      amount: 150,
      type: 'EXPENSE',
    }), params('txn-1'));

    expect(res.status).toBe(200);
    expect(prisma.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'bank-1' },
      data: { currentBalance: { increment: -50 } },
    });
  });

  it('moves the balance effect to the new bank account when a transaction is reassigned', async () => {
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: 'bank-2' } as never);
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue({
      id: 'txn-1',
      bankAccountId: 'bank-1',
      type: 'INCOME',
      amount: 100,
    } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({
      id: 'txn-1',
      bankAccount: { id: 'bank-2', name: 'Second Bank' },
    } as never);
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'bank-1' } as never);

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
    vi.mocked(prisma.bankTransaction.delete).mockResolvedValue({ id: 'txn-1' } as never);
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'bank-1' } as never);

    const res = await deleteBankTransaction(
      makeReq('/api/v1/bank-transactions/txn-1', 'org-a', 'DELETE'),
      params('txn-1'),
    );

    expect(res.status).toBe(200);
    expect(prisma.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'bank-1' },
      data: { currentBalance: { increment: 100 } },
    });
    expect(prisma.bankTransaction.delete).toHaveBeenCalledWith({
      where: { id: 'txn-1', organizationId: 'org-a' },
    });
  });
});
