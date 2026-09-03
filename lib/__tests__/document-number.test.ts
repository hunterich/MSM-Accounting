import { describe, expect, it } from 'vitest';
import { documentNumberScope, formatDocumentNumber, parseSequence } from '@/lib/organization/document-number';

const date = new Date('2026-09-03T10:00:00.000Z');

describe('formatDocumentNumber', () => {
  it('monthly reset: PREFIX/YYYY/MM/SEQ', () => {
    expect(formatDocumentNumber({ prefix: 'INV', resetPeriod: 'monthly', seqLength: 6 }, 9, date)).toBe('INV/2026/09/000009');
  });
  it('yearly reset: PREFIX/YYYY/SEQ', () => {
    expect(formatDocumentNumber({ prefix: 'FAK', resetPeriod: 'yearly', seqLength: 8 }, 42, date)).toBe('FAK/2026/00000042');
  });
  it('never: the legacy PREFIX-SEQ shape, so existing rows keep counting', () => {
    expect(formatDocumentNumber({ prefix: 'INV', resetPeriod: 'never', seqLength: 6 }, 10, date)).toBe('INV-000010');
  });
  it('keeps counting past the padded width', () => {
    expect(formatDocumentNumber({ prefix: 'INV', resetPeriod: 'never', seqLength: 4 }, 12345, date)).toBe('INV-12345');
  });
  it('reads the period in UTC, like the rest of the ledger', () => {
    expect(formatDocumentNumber({ prefix: 'INV', resetPeriod: 'monthly', seqLength: 4 }, 1, new Date('2026-09-30T23:30:00.000Z'))).toBe('INV/2026/09/0001');
  });
});

describe('documentNumberScope / parseSequence', () => {
  it('scopes the sequence to the current month and ignores other periods and shapes', () => {
    const cfg = { prefix: 'INV', resetPeriod: 'monthly', seqLength: 6 };
    expect(documentNumberScope(cfg, date)).toEqual({ like: 'INV/2026/09/%', regex: '^INV/2026/09/(\\d+)$' });
    expect(parseSequence(cfg, date, 'INV/2026/09/000012')).toBe(12);
    expect(parseSequence(cfg, date, 'INV/2026/08/000012')).toBeNull();
    expect(parseSequence(cfg, date, 'INV-000012')).toBeNull();
  });
  it('the legacy scope matches only PREFIX-digits', () => {
    const cfg = { prefix: 'INV', resetPeriod: 'never', seqLength: 6 };
    expect(documentNumberScope(cfg, date)).toEqual({ like: 'INV-%', regex: '^INV-(\\d+)$' });
    expect(parseSequence(cfg, date, 'INV-000009')).toBe(9);
    expect(parseSequence(cfg, date, 'INV-QA123')).toBeNull();
  });
  it('escapes a prefix with regex metacharacters', () => {
    const cfg = { prefix: 'A.B', resetPeriod: 'never', seqLength: 4 };
    expect(parseSequence(cfg, date, 'AXB-0001')).toBeNull();
    expect(parseSequence(cfg, date, 'A.B-0001')).toBe(1);
  });
});
