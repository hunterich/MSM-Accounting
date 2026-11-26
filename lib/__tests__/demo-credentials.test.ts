import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS, demoPasswordsAllowed, isDemoPassword, resolveSeedPassword } from '../demo-credentials';
import { passwordSchema } from '../password';

const [admin, cashier] = DEMO_ACCOUNTS;
const generate = () => 'Generated-secret9';

describe('demoPasswordsAllowed', () => {
  it('allows demo passwords outside production', () => {
    expect(demoPasswordsAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(demoPasswordsAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(demoPasswordsAllowed({})).toBe(true);
  });
  it('refuses them in production unless explicitly opted in', () => {
    expect(demoPasswordsAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(demoPasswordsAllowed({ NODE_ENV: 'production', ALLOW_DEMO_PASSWORDS: '1' })).toBe(false);
    expect(demoPasswordsAllowed({ NODE_ENV: 'production', ALLOW_DEMO_PASSWORDS: 'true' })).toBe(true);
  });
});

describe('isDemoPassword', () => {
  it('matches only the published demo passwords', () => {
    expect(isDemoPassword('admin123')).toBe(true);
    expect(isDemoPassword('cashier123')).toBe(true);
    expect(isDemoPassword('Admin123')).toBe(false);
    expect(isDemoPassword('admin1234')).toBe(false);
  });
});

describe('resolveSeedPassword', () => {
  it('uses the demo password without a forced change in development', () => {
    expect(resolveSeedPassword(admin, generate, { NODE_ENV: 'development' }))
      .toEqual({ password: 'admin123', source: 'demo', mustChangePassword: false });
    expect(resolveSeedPassword(cashier, generate, {}).password).toBe('cashier123');
  });

  it('generates a one-time password and forces a change in production', () => {
    expect(resolveSeedPassword(admin, generate, { NODE_ENV: 'production' }))
      .toEqual({ password: 'Generated-secret9', source: 'generated', mustChangePassword: true });
  });

  it('takes the password from the environment, forcing a change in production', () => {
    expect(resolveSeedPassword(admin, generate, { NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'Operator-pass1' }))
      .toEqual({ password: 'Operator-pass1', source: 'env', mustChangePassword: true });
    expect(resolveSeedPassword(cashier, generate, { SEED_CASHIER_PASSWORD: 'Dev-cashier1' }))
      .toEqual({ password: 'Dev-cashier1', source: 'env', mustChangePassword: false });
  });

  it('refuses a published demo password from the environment in production', () => {
    expect(() => resolveSeedPassword(admin, generate, { NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'admin123' }))
      .toThrow(/published demo password/);
  });

  it('keeps the demo password for an explicitly opted-in production benchmark', () => {
    expect(resolveSeedPassword(admin, generate, { NODE_ENV: 'production', ALLOW_DEMO_PASSWORDS: 'true' }))
      .toEqual({ password: 'admin123', source: 'demo', mustChangePassword: false });
  });
});

describe('passwordSchema', () => {
  it('refuses a published demo password as a new password', () => {
    for (const p of ['admin123', 'cashier123']) {
      const r = passwordSchema.safeParse(p);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toMatch(/published demo password/);
    }
  });
});
