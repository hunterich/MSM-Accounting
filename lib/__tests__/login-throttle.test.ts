import { describe, expect, it } from 'vitest';
import { LoginThrottle, clientAddress } from '@/lib/login-throttle';

const policy = { windowMs: 60_000, maxPerEmail: 3, maxPerIp: 5 };
const T0 = 1_000_000;

describe('LoginThrottle', () => {
  it('allows attempts until the per-account limit, then locks for the rest of the window', () => {
    const t = new LoginThrottle(policy);
    for (let i = 0; i < 3; i++) {
      expect(t.check('a@x.test', '10.0.0.1', T0 + i).allowed).toBe(true);
      t.recordFailure('a@x.test', '10.0.0.1', T0 + i);
    }
    const verdict = t.check('a@x.test', '10.0.0.1', T0 + 10_000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(50); // window ends 60s after the oldest failure
    // The window slides: once the oldest failure ages out, one more try is allowed.
    expect(t.check('a@x.test', '10.0.0.1', T0 + 60_001).allowed).toBe(true);
  });

  it('is case- and whitespace-insensitive on the email, and separate per account', () => {
    const t = new LoginThrottle(policy);
    for (let i = 0; i < 3; i++) t.recordFailure(' A@X.test ', '10.0.0.1', T0);
    expect(t.check('a@x.test', '10.0.0.1', T0 + 1).allowed).toBe(false);
    expect(t.check('b@x.test', '10.0.0.1', T0 + 1).allowed).toBe(true);
  });

  it('locks an address that fails across many accounts', () => {
    const t = new LoginThrottle(policy);
    for (let i = 0; i < 5; i++) t.recordFailure(`u${i}@x.test`, '10.0.0.9', T0 + i);
    expect(t.check('fresh@x.test', '10.0.0.9', T0 + 10).allowed).toBe(false);
    expect(t.check('fresh@x.test', '10.0.0.10', T0 + 10).allowed).toBe(true);
  });

  it('a successful login clears the account counter but not the address counter', () => {
    const t = new LoginThrottle(policy);
    for (let i = 0; i < 2; i++) t.recordFailure('a@x.test', '10.0.0.1', T0);
    t.recordSuccess('a@x.test');
    for (let i = 0; i < 2; i++) t.recordFailure('a@x.test', '10.0.0.1', T0 + 1);
    expect(t.check('a@x.test', '10.0.0.1', T0 + 2).allowed).toBe(true); // 2 < 3 after the reset
    // 4 address failures so far; one more locks the address.
    t.recordFailure('z@x.test', '10.0.0.1', T0 + 3);
    expect(t.check('a@x.test', '10.0.0.1', T0 + 4).allowed).toBe(false);
  });

  it('forgets everything once the window has passed', () => {
    const t = new LoginThrottle(policy);
    for (let i = 0; i < 3; i++) t.recordFailure('a@x.test', '10.0.0.1', T0);
    expect(t.check('a@x.test', '10.0.0.1', T0 + 61_000).allowed).toBe(true);
  });
});

describe('clientAddress', () => {
  const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
  it('takes the first X-Forwarded-For hop, then X-Real-IP, then "unknown"', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientAddress(headers({}))).toBe('unknown');
  });
});
