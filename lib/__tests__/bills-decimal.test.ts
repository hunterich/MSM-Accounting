/**
 * Regression coverage for `createBillRecord` Decimal arithmetic.
 *
 * Pre-fix the helper used `asMoney(toNumber(qty) * toNumber(price))` —
 * float multiplication then a 2dp round. That was sufficient for the
 * common case but didn't give parity with `lib/journal-posting.ts`,
 * which uses `Prisma.Decimal` end-to-end. Now both paths produce a
 * Decimal with no intermediate float drift, regardless of input shape.
 *
 * These tests pin the contract: BillLine rows persisted by the helper
 * are Prisma.Decimal instances with exact 2dp values, and lineTotal
 * matches the Decimal product (not the float product).
 */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// `nextNumber` and `validateForeignKey` from api-utils talk to the real
// Prisma client / DB via `$executeRaw`; bypass them in unit tests so the
// helper's Decimal arithmetic is exercised in isolation.
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    nextNumber: vi.fn(async () => 'BILL-0001'),
    validateForeignKey: vi.fn(async () => undefined),
  };
});

import { createBillRecord } from '../bills';
import type { BillInput } from '@/types/api';

type CreateManyArgs = { data: Array<Record<string, unknown>> };

function makeTx() {
  const calls = {
    bill: { create: vi.fn() },
    billLine: { createMany: vi.fn() },
    billAttachment: { create: vi.fn() },
    vendor: { findFirst: vi.fn() },
    purchaseOrder: { findFirst: vi.fn() },
  };
  const tx = {
    bill: {
      create: vi.fn(async ({ data }: { data: { number: string } }) => {
        calls.bill.create({ data });
        return { id: 'bill-1', ...data };
      }),
      findUnique: vi.fn(async () => ({ id: 'bill-1', lines: [], attachments: [] })),
    },
    billLine: {
      createMany: vi.fn(async (args: CreateManyArgs) => {
        calls.billLine.createMany(args);
        return { count: args.data.length };
      }),
    },
    billAttachment: { create: vi.fn() },
    vendor: { findFirst: vi.fn(async () => ({ id: 'v-1' })) },
    purchaseOrder: { findFirst: vi.fn(async () => ({ id: 'po-1' })) },
    $queryRaw: vi.fn().mockResolvedValue([{ max_seq: 0 }]),
  };
  return { tx, calls };
}

const baseHeader: Omit<BillInput, 'lines'> = {
  organizationId: 'org-1',
  vendorId: 'v-1',
  issueDate: '2026-05-08',
  status: 'DRAFT',
  taxRate: 0,
  taxable: false,
  taxInclusive: false,
  subtotal: 0,
  taxAmount: 0,
  totalAmount: 0,
};

function lastLines(calls: ReturnType<typeof makeTx>['calls']): Array<Record<string, unknown>> {
  const last = calls.billLine.createMany.mock.calls.at(-1)?.[0] as CreateManyArgs;
  return last.data;
}

describe('createBillRecord — Decimal arithmetic', () => {
  it('persists quantity, price, and lineTotal as Prisma.Decimal instances', async () => {
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      lines: [{ description: 'Item', quantity: 2, price: 50, unit: 'PCS' }],
    });

    const [line] = lastLines(calls);
    expect(line.quantity).toBeInstanceOf(Prisma.Decimal);
    expect(line.price).toBeInstanceOf(Prisma.Decimal);
    expect(line.lineTotal).toBeInstanceOf(Prisma.Decimal);
    expect(String(line.lineTotal)).toBe('100');
  });

  it('computes lineTotal exactly for the classic 0.1 * 0.2 IEEE-754 case', async () => {
    // Float math: 0.1 * 0.2 === 0.020000000000000004
    // Decimal math: 0.1 * 0.2 === 0.02 exactly
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      lines: [{ description: 'Tiny', quantity: 0.1, price: 0.2, unit: 'PCS' }],
    });

    const [line] = lastLines(calls);
    expect(0.1 * 0.2).not.toBe(0.02);
    expect(String(line.lineTotal)).toBe('0.02');
  });

  it('rounds half-up at the 2nd decimal place (1.005 → 1.01)', async () => {
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      lines: [{ description: 'Round', quantity: 1, price: 1.005, unit: 'PCS' }],
    });

    const [line] = lastLines(calls);
    expect(String(line.lineTotal)).toBe('1.01');
  });

  it('does not float-drift over multiple lines (sum of 100×0.1 stays exact at 2dp)', async () => {
    const { tx, calls } = makeTx();
    const lines = Array.from({ length: 100 }, (_, i) => ({
      description: `Line ${i + 1}`,
      quantity: 1,
      price: 0.1,
      unit: 'PCS',
    }));
    await createBillRecord(tx as never, 'org-1', { ...baseHeader, lines });

    const persisted = lastLines(calls);
    // Each lineTotal must be exactly 0.1 — no drift, no rounding artifacts.
    for (const line of persisted) {
      expect(String(line.lineTotal)).toBe('0.1');
    }
    // The sum of all persisted lineTotals as Decimal is exactly 10.
    const sum = persisted.reduce<Prisma.Decimal>(
      (acc, l) => acc.plus(l.lineTotal as Prisma.Decimal),
      new Prisma.Decimal(0),
    );
    expect(String(sum)).toBe('10');
  });

  it('uses the client-supplied lineTotal verbatim when present (rounded to 2dp)', async () => {
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      lines: [{
        description: 'Override',
        quantity: 3,
        price: 7.49,
        // Client-supplied total — could differ from qty*price (e.g. tax-inclusive math)
        lineTotal: 22.47,
        unit: 'PCS',
      }],
    });

    const [line] = lastLines(calls);
    expect(String(line.lineTotal)).toBe('22.47');
  });

  it('preserves quantity precision at 4dp (column allows Decimal(18,4))', async () => {
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      lines: [{ description: 'Precise', quantity: 2.5, price: 4, unit: 'KG' }],
    });

    const [line] = lastLines(calls);
    expect(String(line.quantity)).toBe('2.5');
    expect(String(line.price)).toBe('4');
    expect(String(line.lineTotal)).toBe('10');
  });

  it('coerces numeric-string inputs (e.g. "12.34") into Decimal without going through Number', async () => {
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      // Cast — the BillInput type expects number, but the helper must
      // tolerate string inputs that some callers pass before zod parsing.
      lines: [{ description: 'String', quantity: '3' as unknown as number, price: '0.1' as unknown as number, unit: 'PCS' }],
    });

    const [line] = lastLines(calls);
    expect(String(line.lineTotal)).toBe('0.3');
  });

  it('returns ZERO Decimal for null/undefined/empty values rather than NaN', async () => {
    const { tx, calls } = makeTx();
    await createBillRecord(tx as never, 'org-1', {
      ...baseHeader,
      lines: [{
        description: 'Empty',
        quantity: undefined as unknown as number,
        price: null as unknown as number,
        unit: 'PCS',
      }],
    });

    const [line] = lastLines(calls);
    expect(String(line.quantity)).toBe('0');
    expect(String(line.price)).toBe('0');
    expect(String(line.lineTotal)).toBe('0');
  });
});
