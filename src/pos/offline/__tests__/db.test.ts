import { describe, expect, it } from 'vitest';
import { posDbName, LEGACY_POS_DB_NAME } from '../db';

describe('posDbName', () => {
  it('composes the per-company database name from the org id', () => {
    expect(posDbName('org-demo')).toBe('pharmacy-pos:org-demo');
    expect(posDbName('cmrebdv020000u6q3zqjlivnl')).toBe('pharmacy-pos:cmrebdv020000u6q3zqjlivnl');
  });

  it('is prefixed by, but distinct from, the legacy shared name', () => {
    expect(LEGACY_POS_DB_NAME).toBe('pharmacy-pos');
    expect(posDbName('x')).toBe(`${LEGACY_POS_DB_NAME}:x`);
    expect(posDbName('x')).not.toBe(LEGACY_POS_DB_NAME);
  });

  it('produces a different database name per company', () => {
    expect(posDbName('a')).not.toBe(posDbName('b'));
  });
});
