import { describe, expect, it } from 'vitest';
import { passwordSchema } from '../password';

describe('passwordSchema', () => {
  it('accepts a password with letters and numbers, min 8 chars', () => {
    expect(passwordSchema.safeParse('secret123').success).toBe(true);
  });

  it('rejects fewer than 8 characters', () => {
    const r = passwordSchema.safeParse('ab12');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/8 characters/);
  });

  it('rejects letters-only', () => {
    const r = passwordSchema.safeParse('onlyletters');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/number/);
  });

  it('rejects numbers-only', () => {
    const r = passwordSchema.safeParse('12345678');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/letter/);
  });
});
