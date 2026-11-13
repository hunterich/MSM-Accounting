import { expect, it, vi } from 'vitest';
import { readSubledgerHistory, reportDate } from '../subledger-history';

it('uses Jakarta month-end boundaries independent of the server timezone', () => {
  expect(reportDate('2026-09-30', false).toISOString()).toBe('2026-09-29T17:00:00.000Z');
  expect(reportDate('2026-09-30', true).toISOString()).toBe('2026-09-30T16:59:59.999Z');
  expect(reportDate('2026-10-01', false).getTime()).toBe(reportDate('2026-09-30', true).getTime() + 1);
});

it.each(['2026-02-30', 'nonsense', '2026-13-01'])('rejects invalid calendar date %s', date => {
  expect(() => reportDate(date, true)).toThrow(/Invalid date/);
});

it.each(['ar', 'ap'] as const)('keeps %s balances identical when statement rows are omitted', async (kind) => {
  const ar = kind === 'ar';
  const date = new Date('2026-10-01T00:00:00Z');
  const asOf = new Date('2026-10-16T00:00:00Z');
  const payment = {
    number: 'P1', status: 'COMPLETED', date, totalAmount: 100, journalEntryId: 'journal',
    ...(ar ? { customerId: 'party' } : { vendorId: 'party' }),
    allocations: [{ amountApplied: 100, discountAmount: 20, penaltyAmount: 0, ...(ar ? { invoiceId: 'doc' } : { billId: 'doc' }) }],
  };
  const note = {
    number: 'N1', status: 'APPLIED', date, amount: 40, journalEntryId: null,
    settlementType: ar ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL',
    ...(ar ? { sourceInvoiceId: 'doc', customerId: 'party' } : { sourceBillId: 'doc', vendorId: 'party' }),
  };
  const db = {
    aRPayment: { findMany: vi.fn().mockResolvedValue([payment]) },
    aPPayment: { findMany: vi.fn().mockResolvedValue([payment]) },
    creditNote: { findMany: vi.fn().mockResolvedValue([note]) },
    debitNote: { findMany: vi.fn().mockResolvedValue([note]) },
    journalEntry: { findMany: vi.fn().mockResolvedValue([{ id: 'journal', source: 'PAYMENT', date, lines: [] }]) },
  } as unknown as Parameters<typeof readSubledgerHistory>[0];
  const documents = [{ id: 'doc', number: 'D1', status: ar ? 'SENT' : 'OPEN', issueDate: date, totalAmount: 200 }];
  const statement = await readSubledgerHistory(db, kind, 'org', documents, asOf);
  const aging = await readSubledgerHistory(db, kind, 'org', documents, asOf, undefined, { includeTransactions: false });
  expect(statement.txns).toHaveLength(3);
  expect(aging.txns).toEqual([]);
  expect(aging.cleared.get('doc')).toBe(160);
  expect(aging.cleared).toEqual(statement.cleared);
  expect(aging.unallocated).toEqual(statement.unallocated);
  expect(aging.documents).toEqual(statement.documents);
  expect(aging.warnings).toEqual(statement.warnings);
});
