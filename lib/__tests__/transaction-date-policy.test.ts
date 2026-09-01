import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRANSACTION_DATE_POLICY,
  parseTransactionDatePolicy,
  evaluateTransactionDate,
  type TransactionDatePolicy,
} from '../transaction-date-policy';

const NOW = new Date('2026-06-15T09:30:00.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const policy = (over: Partial<TransactionDatePolicy> = {}): TransactionDatePolicy => ({
  enabled: true,
  mode: 'BLOCK',
  daysBefore: 30,
  daysAfter: 7,
  ...over,
});

describe('parseTransactionDatePolicy', () => {
  it('treats an absent or unreadable value as disabled', () => {
    for (const raw of [null, undefined, 'nonsense', 42, [], {}]) {
      expect(parseTransactionDatePolicy(raw)).toEqual(DEFAULT_TRANSACTION_DATE_POLICY);
    }
  });

  it('reads a stored policy', () => {
    expect(
      parseTransactionDatePolicy({ enabled: true, mode: 'BLOCK', daysBefore: 30, daysAfter: 7 }),
    ).toEqual({ enabled: true, mode: 'BLOCK', daysBefore: 30, daysAfter: 7 });
  });

  it('defaults an unrecognised mode to WARN rather than blocking on a typo', () => {
    expect(parseTransactionDatePolicy({ enabled: true, mode: 'HALT', daysBefore: 5 }).mode).toBe('WARN');
  });

  it('rejects a negative or non-numeric bound instead of restricting by it', () => {
    const p = parseTransactionDatePolicy({ enabled: true, daysBefore: -5, daysAfter: 'soon' });
    expect(p.daysBefore).toBeNull();
    expect(p.daysAfter).toBeNull();
    // Neither bound survived, so there is nothing to enforce.
    expect(p.enabled).toBe(false);
  });

  it('floors a fractional bound', () => {
    expect(parseTransactionDatePolicy({ enabled: true, daysBefore: 30.9 }).daysBefore).toBe(30);
  });

  it('is disabled when enabled is true but both bounds are open', () => {
    expect(
      parseTransactionDatePolicy({ enabled: true, daysBefore: null, daysAfter: null }).enabled,
    ).toBe(false);
  });

  it('is disabled when the bounds are set but enabled is false', () => {
    expect(parseTransactionDatePolicy({ enabled: false, daysBefore: 30 }).enabled).toBe(false);
  });
});

describe('evaluateTransactionDate', () => {
  it('allows anything when the policy is disabled', () => {
    expect(evaluateTransactionDate(policy({ enabled: false }), day('2001-01-01'), NOW).status).toBe('ok');
  });

  it('allows today', () => {
    expect(evaluateTransactionDate(policy(), day('2026-06-15'), NOW).status).toBe('ok');
  });

  it('includes both bounds — the limit day itself is allowed', () => {
    expect(evaluateTransactionDate(policy(), day('2026-05-16'), NOW).status).toBe('ok'); // -30
    expect(evaluateTransactionDate(policy(), day('2026-06-22'), NOW).status).toBe('ok'); // +7
  });

  it('rejects the first day past each bound', () => {
    const before = evaluateTransactionDate(policy(), day('2026-05-15'), NOW); // -31
    expect(before.status).toBe('outside');
    expect(before.direction).toBe('before');
    expect(before.daysOutside).toBe(1);
    expect(before.message).toContain('31 days in the past');
    expect(before.message).toContain('at most 30 days');

    const after = evaluateTransactionDate(policy(), day('2026-06-23'), NOW); // +8
    expect(after.status).toBe('outside');
    expect(after.direction).toBe('after');
    expect(after.daysOutside).toBe(1);
    expect(after.message).toContain('8 days in the future');
  });

  it('compares whole days, so the time of day never decides it', () => {
    const lateInTheDay = new Date('2026-06-15T23:59:59.000Z');
    const earlyLimit = new Date('2026-05-16T00:00:01.000Z');
    expect(evaluateTransactionDate(policy(), earlyLimit, lateInTheDay).status).toBe('ok');
  });

  it('leaves the other side open when only one bound is set', () => {
    const backOnly = policy({ daysAfter: null });
    expect(evaluateTransactionDate(backOnly, day('2030-01-01'), NOW).status).toBe('ok');
    expect(evaluateTransactionDate(backOnly, day('2020-01-01'), NOW).status).toBe('outside');

    const forwardOnly = policy({ daysBefore: null });
    expect(evaluateTransactionDate(forwardOnly, day('2020-01-01'), NOW).status).toBe('ok');
    expect(evaluateTransactionDate(forwardOnly, day('2030-01-01'), NOW).status).toBe('outside');
  });

  it('allows everything with a zero-day window only on today itself', () => {
    const sameDayOnly = policy({ daysBefore: 0, daysAfter: 0 });
    expect(evaluateTransactionDate(sameDayOnly, day('2026-06-15'), NOW).status).toBe('ok');
    expect(evaluateTransactionDate(sameDayOnly, day('2026-06-14'), NOW).status).toBe('outside');
    expect(evaluateTransactionDate(sameDayOnly, day('2026-06-16'), NOW).status).toBe('outside');
  });

  it('says nothing about an unparseable date — that is the form’s job, not this one’s', () => {
    expect(evaluateTransactionDate(policy(), new Date('not-a-date'), NOW).status).toBe('ok');
  });

  it('reports WARN and BLOCK identically — the mode decides what is done, not what is true', () => {
    const far = day('2020-01-01');
    expect(evaluateTransactionDate(policy({ mode: 'WARN' }), far, NOW)).toEqual(
      evaluateTransactionDate(policy({ mode: 'BLOCK' }), far, NOW),
    );
  });
});
