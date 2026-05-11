/**
 * Tests for the journal-balance test helper itself, plus precision-loss
 * coverage for the money helpers (asMoney + toNumber). The helper is what
 * other integration tests will use to assert posting routes don't write
 * unbalanced entries — so it has to detect imbalance reliably AND tolerate
 * the half-cent rounding that `Decimal(18,2)` round-trips can produce.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  assertLinesBalanced,
  assertJournalBalances,
} from './journal-balance-helper';
import { asMoney, toNumber } from '../money';

describe('assertLinesBalanced', () => {
  it('passes when debits === credits as numbers', () => {
    expect(() =>
      assertLinesBalanced([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 100 },
      ]),
    ).not.toThrow();
  });

  it('passes when debits === credits as Prisma.Decimal (post-DB read)', () => {
    expect(() =>
      assertLinesBalanced([
        { debit: new Prisma.Decimal('1234.56'), credit: new Prisma.Decimal(0) },
        { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal('1234.56') },
      ]),
    ).not.toThrow();
  });

  it('passes within half-cent rounding tolerance', () => {
    expect(() =>
      assertLinesBalanced([
        { debit: 100.001, credit: 0 },
        { debit: 0, credit: 100 },
      ]),
    ).not.toThrow();
  });

  it('throws when debits and credits diverge by more than tolerance', () => {
    expect(() =>
      assertLinesBalanced([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 99 },
      ]),
    ).toThrow(/not balanced/);
  });

  it('throws on empty lines list', () => {
    expect(() => assertLinesBalanced([])).toThrow(/empty/);
  });
});

describe('assertJournalBalances (DB-shaped finder)', () => {
  it('queries lines for the entry and asserts balance', async () => {
    let captured: { where: { entryId: string } } | null = null;
    const finder = {
      journalLine: {
        findMany: async (args: {
          where: { entryId: string };
          select: { debit: true; credit: true };
        }) => {
          captured = { where: args.where };
          return [
            { debit: new Prisma.Decimal('500.00'), credit: new Prisma.Decimal(0) },
            { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal('500.00') },
          ];
        },
      },
    };
    await expect(
      assertJournalBalances(finder, 'je-123'),
    ).resolves.toBeUndefined();
    expect(captured!.where.entryId).toBe('je-123');
  });

  it('throws when entry has no lines', async () => {
    const finder = {
      journalLine: { findMany: async () => [] },
    };
    await expect(
      assertJournalBalances(finder, 'je-empty'),
    ).rejects.toThrow(/no lines/);
  });

  it('throws when DB-stored lines are unbalanced', async () => {
    const finder = {
      journalLine: {
        findMany: async () => [
          { debit: new Prisma.Decimal('100.00'), credit: new Prisma.Decimal(0) },
          { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal('99.00') },
        ],
      },
    };
    await expect(
      assertJournalBalances(finder, 'je-bad'),
    ).rejects.toThrow(/not balanced/);
  });
});

describe('money helpers — float precision regression coverage', () => {
  it('asMoney corrects classic 0.1 + 0.2 IEEE-754 drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(asMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('asMoney rounds half-up at the 2nd decimal (1.005 → 1.01)', () => {
    expect(asMoney(1.005)).toBe(1.01);
  });

  it('toNumber unwraps Prisma.Decimal without precision loss for 2dp values', () => {
    const d = new Prisma.Decimal('12345.67');
    expect(toNumber(d)).toBe(12345.67);
  });

  it('summing 100×0.1 then asMoney equals 10.00 (drift mitigation)', () => {
    let acc = 0;
    for (let i = 0; i < 100; i++) acc += 0.1;
    expect(acc).not.toBe(10);
    expect(asMoney(acc)).toBe(10);
  });
});
