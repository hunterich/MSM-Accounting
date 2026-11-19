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

  it('matches the period on the Jakarta business day, not the UTC instant', async () => {
    // 02:00 WIB on 1 April is 19:00 UTC on 31 March. Reports put it in April,
    // so the lock must look up April too, not the (closed) March period.
    const tx = makeTx(null) as unknown as { $queryRaw: ReturnType<typeof vi.fn> };
    await assertPeriodOpen(tx as never, 'org-1', new Date('2026-03-31T19:00:00.000Z'));
    const params = tx.$queryRaw.mock.calls[0].slice(1) as unknown[];
    expect(params).toContainEqual(new Date('2026-04-01T00:00:00.000Z'));
    expect(params).not.toContainEqual(new Date('2026-03-31T19:00:00.000Z'));
  });

  it('names the business day in the refusal', async () => {
    const tx = makeTx({ name: 'Apr 2026', status: 'CLOSED', isLocked: false });
    await expect(assertPeriodOpen(tx, 'org-1', new Date('2026-03-31T19:00:00.000Z')))
      .rejects.toThrow(/cannot post on 2026-04-01/);
  });
});
