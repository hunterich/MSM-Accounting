import { describe, it, expect, afterEach } from 'vitest';
import { signToken, verifyToken } from '../auth.js';

const VALID_SECRET = 'test-secret-at-least-32-characters-long!!';

afterEach(() => {
  delete process.env.JWT_SECRET;
});

describe('signToken', () => {
  it('signs a token and verifyToken round-trips the payload', async () => {
    process.env.JWT_SECRET = VALID_SECRET;
    const payload = { userId: 'u1', orgId: 'org1', email: 'a@b.com', roleType: 'Admin' };
    const token = await signToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT structure

    const result = await verifyToken(token);
    expect(result?.userId).toBe('u1');
    expect(result?.orgId).toBe('org1');
    expect(result?.email).toBe('a@b.com');
    expect(result?.roleType).toBe('Admin');
  });

  it('throws when JWT_SECRET is not set', async () => {
    await expect(
      signToken({ userId: 'u1', orgId: 'org1', email: 'a@b.com', roleType: 'Admin' })
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
    const token = await signToken({ userId: 'u1', orgId: 'org1', email: 'a@b.com', roleType: 'Admin' });

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
