import { describe, it, expect, afterEach, vi } from 'vitest';
import { signToken, verifyToken, credentialStamp, jwtSecretProblem } from '../auth';

const VALID_SECRET = 'test-secret-at-least-32-characters-long!!';

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.unstubAllEnvs();
});

describe('signToken', () => {
  it('signs a token and verifyToken round-trips the payload', async () => {
    process.env.JWT_SECRET = VALID_SECRET;
    const payload = { userId: 'u1', email: 'a@b.com', memberships: [{ orgId: 'org1', roleType: 'Admin' }] };
    const token = await signToken({ ...payload, credentialStamp: 'test-stamp' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT structure

    const result = await verifyToken(token);
    expect(result?.userId).toBe('u1');
    expect(result?.email).toBe('a@b.com');
    expect(result?.memberships).toEqual([{ orgId: 'org1', roleType: 'Admin' }]);
  });

  it('throws when JWT_SECRET is not set', async () => {
    await expect(
      signToken({ userId: 'u1', email: 'a@b.com', memberships: [{ orgId: 'org1', roleType: 'Admin' }] })
    ).rejects.toThrow('JWT_SECRET environment variable is required');
  });
});

describe('verifyToken', () => {
  it('returns null for an invalid token string', async () => {
    process.env.JWT_SECRET = VALID_SECRET;
    const result = await verifyToken('not.a.valid.jwt');
    expect(result).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    process.env.JWT_SECRET = VALID_SECRET;
    const token = await signToken({ userId: 'u1', email: 'a@b.com', memberships: [{ orgId: 'org1', roleType: 'Admin' }] });

    process.env.JWT_SECRET = 'a-completely-different-secret-string!!';
    const result = await verifyToken(token);
    expect(result).toBeNull();
  });

  it('throws when JWT_SECRET is not set', async () => {
    await expect(verifyToken('some.token.string')).rejects.toThrow(
      'JWT_SECRET environment variable is required'
    );
  });
});

describe('session secret strength (SEC-02)', () => {
  const payload = { userId: 'u1', email: 'a@b.com', memberships: [{ orgId: 'org1', roleType: 'ADMIN' }] };

  it.each([
    ['the root .env.example value', 'replace-with-a-long-random-string-in-production'],
    ['the deploy/.env.example value', 'change-me-to-a-long-random-string'],
    ['an edited placeholder', 'please-CHANGE-ME-before-going-live-2026!!'],
  ])('rejects %s', (_label, secret) => {
    expect(jwtSecretProblem(secret)).toMatch(/example value/);
  });

  it('rejects a short secret and says how long it must be', () => {
    expect(jwtSecretProblem('test-secret-key-for-ci')).toMatch(/at least 32 characters long \(it is 22\)/);
  });

  it('rejects a long but repetitive secret', () => {
    expect(jwtSecretProblem('a'.repeat(40))).toMatch(/too repetitive/);
  });

  it('accepts a generated secret', () => {
    expect(jwtSecretProblem('q0nO5Hk3m+u8yR2vXbL7cT1wJ9eZ4aD6pS0fG8hK2lM=')).toBeNull();
    expect(jwtSecretProblem(VALID_SECRET)).toBeNull();
  });

  it('refuses to sign or verify sessions with a weak secret in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.JWT_SECRET = 'change-me-to-a-long-random-string';
    await expect(signToken(payload)).rejects.toThrow(/example value/);
    await expect(verifyToken('some.token.string')).rejects.toThrow(/example value/);
    expect(() => credentialStamp('hash')).toThrow(/example value/);
  });

  it('cannot be used to forge a session in production even with a token signed by the weak secret', async () => {
    process.env.JWT_SECRET = 'change-me-to-a-long-random-string';
    const forged = await signToken({ ...payload, credentialStamp: 'x' }); // signed outside production
    vi.stubEnv('NODE_ENV', 'production');
    await expect(verifyToken(forged)).rejects.toThrow(/example value/);
  });

  it('keeps development and tests working with any non-empty secret', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    process.env.JWT_SECRET = 'short';
    const token = await signToken({ ...payload, credentialStamp: 'x' });
    expect((await verifyToken(token))?.userId).toBe('u1');
  });
});
