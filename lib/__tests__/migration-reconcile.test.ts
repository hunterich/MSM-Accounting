import { describe, it, expect } from 'vitest';
import { reconcileMigration, type ReconcileInput } from '../migration/reconcile';

const base: ReconcileInput = {
  controlCodes: { ar: '1-1200', ap: '2-1100', inventory: '1-1400' },
  trialBalance: [
    { accountCode: '1-1200', debit: 10_000_000, credit: 0 }, // AR control
    { accountCode: '2-1100', debit: 0, credit: 6_000_000 },  // AP control
    { accountCode: '1-1400', debit: 4_000_000, credit: 0 },  // Inventory
    { accountCode: '3-9000', debit: 0, credit: 8_000_000 },  // Opening equity (plug)
  ],
  openAr: [{ amount: 6_000_000 }, { amount: 4_000_000 }],     // sums to 10,000,000
  openAp: [{ amount: 6_000_000 }],                            // sums to 6,000,000
  openingStock: [{ value: 4_000_000 }],                       // sums to 4,000,000
};

describe('reconcileMigration', () => {
  it('passes when TB balances and all subledgers tie to control accounts', () => {
    const r = reconcileMigration(base);
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.pass)).toBe(true);
  });

  it('fails the balance check when TB debits != credits', () => {
    const r = reconcileMigration({
      ...base,
      trialBalance: [...base.trialBalance, { accountCode: '1-1000', debit: 500, credit: 0 }],
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'tb-balanced')!.pass).toBe(false);
  });

  it('fails the AR tie-out when open invoices do not sum to AR control', () => {
    const r = reconcileMigration({ ...base, openAr: [{ amount: 9_999_000 }] });
    expect(r.ok).toBe(false);
    const c = r.checks.find((x) => x.id === 'ar-tie')!;
    expect(c.pass).toBe(false);
    expect(c.expected).toBe(10_000_000);
    expect(c.actual).toBe(9_999_000);
  });

  it('fails the inventory tie-out when stock value != inventory control', () => {
    const r = reconcileMigration({ ...base, openingStock: [{ value: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'inventory-tie')!.pass).toBe(false);
  });

  it('treats an all-empty migration as passing (nothing to reconcile)', () => {
    const r = reconcileMigration({
      controlCodes: base.controlCodes,
      trialBalance: [], openAr: [], openAp: [], openingStock: [],
    });
    expect(r.ok).toBe(true);
  });
});
