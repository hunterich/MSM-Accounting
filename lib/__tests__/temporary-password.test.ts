import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from '../temporary-password';
import { passwordSchema } from '../password';

describe('temporary passwords', () => {
  it('generates independent policy-compliant secrets for repeated requests', () => {
    const passwords = Array.from({ length: 50 }, generateTemporaryPassword);
    expect(new Set(passwords).size).toBe(50);
    for (const password of passwords) {
      expect(passwordSchema.safeParse(password).success).toBe(true);
      expect(password).toMatch(/^Msm-[A-Za-z0-9_-]{32}a1$/);
    }
  });
});
