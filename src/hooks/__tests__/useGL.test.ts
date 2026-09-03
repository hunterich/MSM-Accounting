import { describe, it, expect } from 'vitest';
import { buildJEPayload, fromApiJESource, toApiJESource } from '../useGL';
import { createJournalEntryInputSchema } from '../../../types/api';

/**
 * The journal form's request body is validated by the API's zod schema. The
 * two drifted apart once — Title-case `source`, `description: null` — and the
 * form could not save a single entry (every Post / Save Draft was a 400). This
 * test parses what the hook builds with the server's own schema, so the next
 * drift fails here instead of in production.
 */
describe('buildJEPayload', () => {
  const header = { date: '2026-09-02', memo: 'Opening float', source: 'Manual' };
  const lines = [
    { accountId: 'acc-bank', description: '', debit: '50000', credit: '' },
    { accountId: 'acc-revenue', description: 'Cash sale', debit: '', credit: 50000 },
    { accountId: 'acc-unused', description: 'blank row the form always shows', debit: '', credit: '' },
  ];

  it('produces a body the server schema accepts, for Post and for Save Draft', () => {
    for (const status of ['Posted', 'Draft'] as const) {
      const body = buildJEPayload(header, lines, status);
      const parsed = createJournalEntryInputSchema.safeParse({ ...body, organizationId: 'org-1' });
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe(status.toUpperCase());
        expect(parsed.data.source).toBe('MANUAL');
        expect(parsed.data.lines).toHaveLength(2);
      }
    }
  });

  it('upper-cases every entry type the form offers into the API enum', () => {
    for (const source of ['Manual', 'Adjustment', 'Accrual', 'Prepayment', 'Depreciation', 'Closing', 'Opening', 'Reversal']) {
      const body = buildJEPayload({ ...header, source }, lines, 'Posted');
      const parsed = createJournalEntryInputSchema.safeParse({ ...body, organizationId: 'org-1' });
      expect(parsed.success, `source ${source}`).toBe(true);
    }
  });

  it('omits an empty line description instead of sending null', () => {
    const body = buildJEPayload(header, lines, 'Posted');
    expect(body.lines[0]).not.toHaveProperty('description');
    expect(body.lines[1]).toMatchObject({ description: 'Cash sale' });
  });

  it('drops rows with neither a debit nor a credit', () => {
    const body = buildJEPayload(header, lines, 'Posted');
    expect(body.lines.map((l) => l.accountId)).toEqual(['acc-bank', 'acc-revenue']);
  });
});

describe('journal source casing', () => {
  it('round-trips between the form (Title case) and the API (UPPER_SNAKE)', () => {
    expect(toApiJESource('Manual')).toBe('MANUAL');
    expect(toApiJESource('Depreciation')).toBe('DEPRECIATION');
    expect(toApiJESource('')).toBe('MANUAL');
    expect(toApiJESource(undefined)).toBe('MANUAL');
    expect(fromApiJESource('MANUAL')).toBe('Manual');
    expect(fromApiJESource('ADJUSTMENT')).toBe('Adjustment');
    expect(fromApiJESource(null)).toBe('Manual');
    // An entry loaded from the API shows the matching option in the form.
    expect(toApiJESource(fromApiJESource('REVERSAL'))).toBe('REVERSAL');
  });
});
