import { describe, expect, it } from 'vitest';
import { shouldAdoptLegacy } from '../legacyMigration';

describe('shouldAdoptLegacy', () => {
  it('adopts: legacy exists, single membership, empty target', () => {
    expect(shouldAdoptLegacy({ legacyExists: true, membershipCount: 1, targetOutboxCount: 0, targetHasShift: false })).toBe(true);
  });

  it('skips when there is no legacy database', () => {
    expect(shouldAdoptLegacy({ legacyExists: false, membershipCount: 1, targetOutboxCount: 0, targetHasShift: false })).toBe(false);
  });

  it('skips when the user belongs to more than one company (cannot attribute)', () => {
    expect(shouldAdoptLegacy({ legacyExists: true, membershipCount: 2, targetOutboxCount: 0, targetHasShift: false })).toBe(false);
  });

  it('skips when the target already has queued sales (would clobber)', () => {
    expect(shouldAdoptLegacy({ legacyExists: true, membershipCount: 1, targetOutboxCount: 3, targetHasShift: false })).toBe(false);
  });

  it('skips when the target already has an open shift (would clobber)', () => {
    expect(shouldAdoptLegacy({ legacyExists: true, membershipCount: 1, targetOutboxCount: 0, targetHasShift: true })).toBe(false);
  });

  it('skips a zero-membership edge case', () => {
    expect(shouldAdoptLegacy({ legacyExists: true, membershipCount: 0, targetOutboxCount: 0, targetHasShift: false })).toBe(false);
  });
});
