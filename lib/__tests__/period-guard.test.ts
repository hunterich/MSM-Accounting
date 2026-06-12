/**
 * assertPeriodOpen refuses automatic GL posting into a CLOSED or locked
 * accounting period, and allows it otherwise (open period, or no period at all).
 */
import { describe, expect, it, vi } from 'vitest';
import { assertPeriodOpen } from '../period-guard';

function makeTx(period: unknown) {
  return {
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(period) },
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
