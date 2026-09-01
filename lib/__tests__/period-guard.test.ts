/**
 * assertPeriodOpen refuses automatic GL posting into a CLOSED or locked
 * accounting period, and allows it otherwise (open period, or no period at all).
 */
import { describe, expect, it, vi } from 'vitest';
import { assertPeriodOpen } from '../period-guard';

// assertPeriodOpen now resolves + FOR SHARE-locks the period row via a raw
// query (so a concurrent close serializes), so the tx stub returns rows.
function makeTx(period: unknown, transactionDatePolicy: unknown = null) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(period ? [period] : []),
    // The guard also reads the org's transaction-date window; null is "never
    // configured", which every case below except the last one wants.
    organization: { findUnique: vi.fn().mockResolvedValue({ transactionDatePolicy }) },
  } as never;
}

const DATE = new Date('2026-03-15');

describe('assertPeriodOpen', () => {
  it('rejects posting into a CLOSED period', async () => {
    const tx = makeTx({ name: 'Mar 2026', status: 'CLOSED', isLocked: false });
    await expect(assertPeriodOpen(tx, 'org-1', DATE)).rejects.toThrow(/closed\/locked/);
  });

  it('rejects posting into a locked period', async () => {
    const tx = makeTx({ name: 'Mar 2026', status: 'OPEN', isLocked: true });
    await expect(assertPeriodOpen(tx, 'org-1', DATE)).rejects.toThrow(/closed\/locked/);
  });

  it('allows posting into an OPEN, unlocked period', async () => {
    const tx = makeTx({ name: 'Mar 2026', status: 'OPEN', isLocked: false });
    await expect(assertPeriodOpen(tx, 'org-1', DATE)).resolves.toBeUndefined();
  });

  it('allows posting on a date with no defined period', async () => {
    const tx = makeTx(null);
    await expect(assertPeriodOpen(tx, 'org-1', DATE)).resolves.toBeUndefined();
  });
});
