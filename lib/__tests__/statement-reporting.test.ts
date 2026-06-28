import { describe, it, expect } from 'vitest';
import { computeStatement, computeAging, type StatementTxn } from '../statement-reporting';

const d = (iso: string) => new Date(iso);

describe('computeStatement', () => {
  const periodStart = d('2026-01-01T00:00:00.000Z');
  const periodEnd = d('2026-01-31T23:59:59.999Z');

  const txns: StatementTxn[] = [
    // before the period → fold into opening
    { date: d('2025-12-01'), type: 'Invoice', number: 'INV-PRIOR', debit: 500_000, credit: 0, order: 0 },
    { date: d('2025-12-15'), type: 'Payment', number: 'PAY-PRIOR', debit: 0, credit: 200_000, order: 2 },
    // in the period
    { date: d('2026-01-05'), type: 'Invoice', number: 'INV-1', debit: 2_000_000, credit: 0, order: 0 },
    { date: d('2026-01-20'), type: 'Payment', number: 'PAY-1', debit: 0, credit: 1_000_000, order: 2 },
    { date: d('2026-01-10'), type: 'Credit Note', number: 'CN-1', debit: 0, credit: 300_000, order: 1 },
    // after the period → ignored
    { date: d('2026-02-03'), type: 'Invoice', number: 'INV-FUTURE', debit: 999_000, credit: 0, order: 0 },
  ];

  it('folds pre-period transactions into the opening balance (with seed)', () => {
    const r = computeStatement({ openingSeed: 1_000_000, txns, periodStart, periodEnd });
    // 1,000,000 seed + 500,000 invoice − 200,000 payment
    expect(r.openingBalance).toBe(1_300_000);
  });

  it('lays out in-period rows chronologically with a running balance', () => {
    const r = computeStatement({ openingSeed: 1_000_000, txns, periodStart, periodEnd });
    expect(r.rows.map((row) => row.number)).toEqual(['INV-1', 'CN-1', 'PAY-1']);
    expect(r.rows.map((row) => row.runningBalance)).toEqual([3_300_000, 3_000_000, 2_000_000]);
  });

  it('excludes transactions after the period end', () => {
    const r = computeStatement({ openingSeed: 1_000_000, txns, periodStart, periodEnd });
    expect(r.rows.some((row) => row.number === 'INV-FUTURE')).toBe(false);
  });

  it('totals and closing balance reconcile (opening + debits − credits)', () => {
    const r = computeStatement({ openingSeed: 1_000_000, txns, periodStart, periodEnd });
    expect(r.totalDebits).toBe(2_000_000);
    expect(r.totalCredits).toBe(1_300_000);
    expect(r.closingBalance).toBe(2_000_000);
    expect(r.openingBalance + r.totalDebits - r.totalCredits).toBe(r.closingBalance);
  });

  it('orders same-day transactions by their order field (invoice before payment)', () => {
    const sameDay: StatementTxn[] = [
      { date: d('2026-01-15'), type: 'Payment', number: 'PAY-X', debit: 0, credit: 500_000, order: 2 },
      { date: d('2026-01-15'), type: 'Invoice', number: 'INV-X', debit: 800_000, credit: 0, order: 0 },
    ];
    const r = computeStatement({ openingSeed: 0, txns: sameDay, periodStart, periodEnd });
    expect(r.rows.map((row) => row.number)).toEqual(['INV-X', 'PAY-X']);
    expect(r.closingBalance).toBe(300_000);
  });

  it('handles an empty ledger (opening = seed, no rows)', () => {
    const r = computeStatement({ openingSeed: 250_000, txns: [], periodStart, periodEnd });
    expect(r.openingBalance).toBe(250_000);
    expect(r.rows).toEqual([]);
    expect(r.closingBalance).toBe(250_000);
  });
});

describe('computeAging', () => {
  const asOf = d('2026-01-31T23:59:59.999Z');

  it('buckets open balances by days past due', () => {
    const aging = computeAging(
      [
        { dueDate: d('2026-03-01'), balance: 500_000 }, // not yet due → current
        { dueDate: null, balance: 100_000 },            // no due date → current
        { dueDate: d('2026-01-15'), balance: 1_000_000 }, // 16 days → 1-30
        { dueDate: d('2025-12-10'), balance: 400_000 },  // ~52 days → 31-60
        { dueDate: d('2025-10-01'), balance: 2_000_000 }, // >90 days → 90+
        { dueDate: d('2026-01-15'), balance: 0 },         // zero balance → skipped
      ],
      asOf,
    );
    expect(aging).toEqual({
      current: 600_000,
      d1To30: 1_000_000,
      d31To60: 400_000,
      d61To90: 0,
      d90Plus: 2_000_000,
    });
  });

  it('returns all-zero buckets for no open documents', () => {
    expect(computeAging([], asOf)).toEqual({
      current: 0, d1To30: 0, d31To60: 0, d61To90: 0, d90Plus: 0,
    });
  });
});
