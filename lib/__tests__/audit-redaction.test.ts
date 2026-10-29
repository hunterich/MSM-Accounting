import { describe, expect, it } from 'vitest';
import { redactAuditPayload } from '../audit-redaction';

describe('audit payload redaction', () => {
  it('redacts secrets and bank account numbers recursively without mutating the source', () => {
    const original = { passwordHash: 'hash', nested: [{ api_key: 'key', bankAccountNumber: '123', name: 'Ada' }], accessToken: 'token' };
    expect(redactAuditPayload(original)).toEqual({ passwordHash: '[REDACTED]', nested: [{ api_key: '[REDACTED]', bankAccountNumber: '[REDACTED]', name: 'Ada' }], accessToken: '[REDACTED]' });
    expect(original.nested[0].api_key).toBe('key');
  });

  it('rejects cyclic payloads', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => redactAuditPayload(cyclic)).toThrow();
  });
});
