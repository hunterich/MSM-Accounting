import { describe, it, expect } from 'vitest';
import { resolveApiBase } from './apiBase';

const loc = { protocol: 'https:', hostname: 'accounting.msm' };

describe('resolveApiBase', () => {
  it('returns "" (relative/same-origin) for the "/" sentinel', () => {
    expect(resolveApiBase('/', loc)).toBe('');
  });

  it('returns "" for the "same-origin" sentinel', () => {
    expect(resolveApiBase('same-origin', loc)).toBe('');
  });

  it('uses an explicit absolute URL as-is, trimming a trailing slash', () => {
    expect(resolveApiBase('https://api.example.com/', loc)).toBe('https://api.example.com');
    expect(resolveApiBase('http://localhost:3000', loc)).toBe('http://localhost:3000');
  });

  it('falls back to the current host on :3000 when unset (dev two-port setup)', () => {
    expect(resolveApiBase(undefined, { protocol: 'http:', hostname: 'localhost' })).toBe(
      'http://localhost:3000',
    );
  });

  it('treats whitespace-only as unset', () => {
    expect(resolveApiBase('   ', { protocol: 'http:', hostname: 'localhost' })).toBe(
      'http://localhost:3000',
    );
  });

  it('falls back to localhost:3000 when there is no window (non-browser)', () => {
    expect(resolveApiBase(undefined, undefined)).toBe('http://localhost:3000');
  });
});
