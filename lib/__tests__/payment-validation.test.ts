import { describe, expect, it } from 'vitest';
import { assertPaymentEditable } from '../payment-validation';

describe('posted payment immutability', () => {
  it('permits draft editing', () => {
    expect(() => assertPaymentEditable({ status: 'DRAFT', journalEntryId: null }, { totalAmount: 600 })).not.toThrow();
  });
  it.each(['COMPLETED', 'PENDING_APPROVAL', 'VOID'])('rejects financial and status changes to %s payments', status => {
    const existing = { status, journalEntryId: status === 'COMPLETED' ? 'journal' : null };
    for (const change of [{ totalAmount: 1 }, { allocations: [] }, { status: 'DRAFT' }, { date: '2026-10-08' }]) {
      expect(() => assertPaymentEditable(existing, change)).toThrow(/Only draft/);
    }
  });
  it('permits an idempotent completion-status replay', () => {
    expect(() => assertPaymentEditable({ status: 'COMPLETED', journalEntryId: 'journal' }, { status: 'COMPLETED' })).not.toThrow();
  });
  it('permits only status-only completion of an unposted processing payment', () => {
    const existing = { status: 'PROCESSING', journalEntryId: null };
    expect(() => assertPaymentEditable(existing, { status: 'COMPLETED' })).not.toThrow();
    expect(() => assertPaymentEditable(existing, { status: 'COMPLETED', totalAmount: 600 })).toThrow(/Only draft/);
    expect(() => assertPaymentEditable({ ...existing, journalEntryId: 'legacy' }, { status: 'COMPLETED' })).toThrow(/Only draft/);
  });
});
