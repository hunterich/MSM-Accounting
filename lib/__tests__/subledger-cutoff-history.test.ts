import { describe, expect, it, vi } from 'vitest';
import { readSubledgerHistory, reportDate } from '../subledger-history';
import { computeStatement } from '../statement-reporting';

const posted = new Date('2026-09-10T00:00:00Z');
const cutoff = reportDate('2026-09-30', true);
const voidDate = new Date(cutoff.getTime() + 1);

for (const kind of ['ar', 'ap'] as const) describe(`${kind} cutoff history`, () => {
  const ar = kind === 'ar';
  // Literal contracts: changing punctuation/case in a void writer must fail
  // these tests and the database regression, not silently lose old snapshots.
  const memos = ar
    ? ['Void invoice: DOC: 1', 'Void AR receipt: PAY: 1', 'Void credit note: NOTE: 1']
    : ['Void bill: DOC: 1', 'Void AP payment: PAY: 1', 'Void debit note: NOTE: 1'];
  const documents = [{ id: 'doc', number: 'DOC: 1', issueDate: posted, totalAmount: 100, status: 'VOID' }];
  const payment = {
    number: 'PAY: 1', status: 'VOID', date: posted, totalAmount: 30, journalEntryId: 'pay-je',
    ...(ar ? { customerId: 'party' } : { vendorId: 'party' }),
    allocations: [{ amountApplied: 30, discountAmount: 0, penaltyAmount: 0, ...(ar ? { invoiceId: 'doc' } : { billId: 'doc' }) }],
  };
  const note = {
    number: 'NOTE: 1', status: 'VOID', date: posted, amount: 20, journalEntryId: 'note-je',
    settlementType: ar ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL',
    ...(ar ? { customerId: 'party', sourceInvoiceId: 'doc' } : { vendorId: 'party', sourceBillId: 'doc' }),
  };
  const reversals = () => memos.map((memo, i) => ({ id: `rev-${i}`, memo, source: 'REVERSAL', date: voidDate, lines: [] }));
  function fixture(entries = reversals(), allocations = payment.allocations) {
    const findPayments = { findMany: vi.fn().mockResolvedValue([{ ...payment, allocations }]) };
    const findNotes = { findMany: vi.fn().mockResolvedValue([note]) };
    const db = {
      aRPayment: findPayments, aPPayment: findPayments, creditNote: findNotes, debitNote: findNotes,
      journalEntry: { findMany: vi.fn(async (query) => {
        expect(query.where.organizationId).toBe('org');
        expect(query.where.status).toBe('POSTED');
        expect(query.where.OR[0].source).toBe('REVERSAL');
        expect(query.where.OR[0].memo.in).toEqual(memos);
        return entries.filter(e => query.where.OR[0].memo.in.includes(e.memo));
      }) },
    } as unknown as Parameters<typeof readSubledgerHistory>[0];
    return (asOf: Date) => readSubledgerHistory(db, kind, 'org', documents, asOf, 'party');
  }
  function statement(history: Awaited<ReturnType<typeof readSubledgerHistory>>, end: Date, start = reportDate('2026-09-01', false)) {
    return computeStatement({ openingSeed: 0, txns: history.txns, periodStart: start, periodEnd: end });
  }

  it('retains later-voided debt at cutoff and reverses at Jakarta midnight exactly', async () => {
    const read = fixture();
    const before = await read(cutoff);
    expect(before.documents).toEqual(documents);
    expect(before.cleared.get('doc')).toBe(50);
    expect(statement(before, cutoff).closingBalance).toBe(50);
    expect(before.warnings).toEqual([]);
    const after = await read(voidDate);
    expect(after.documents).toEqual([]);
    expect(after.cleared.size).toBe(0);
    expect(statement(after, voidDate).closingBalance).toBe(0);
    const october = statement(after, voidDate, voidDate);
    expect(october.openingBalance).toBe(50);
    expect(october.rows.map(r => r.type)).toEqual([ar ? 'Void Invoice' : 'Void Bill', 'Void Payment', ar ? 'Void Credit Note' : 'Void Debit Note']);
  });

  it.each([0, 1, 2])('warns by name when exact reversal memo %i is missing or differs', async index => {
    const entries = reversals();
    entries[index].memo += ' (legacy format)';
    const result = await fixture(entries)(cutoff);
    const labels = ar ? ['invoice DOC: 1', 'AR receipt PAY: 1', 'credit note NOTE: 1'] : ['bill DOC: 1', 'AP payment PAY: 1', 'debit note NOTE: 1'];
    expect(result.warnings).toEqual([`Historical reversal unavailable for voided ${labels[index]}; past balances cannot be confirmed`]);
    expect(result.txns.some(t => t.number === ['DOC: 1', 'PAY: 1', 'NOTE: 1'][index])).toBe(false);
  });

  it('warns when legacy payment allocations were deleted', async () => {
    const result = await fixture(reversals(), [])(cutoff);
    expect(result.warnings).toContain('Historical allocation unavailable for voided payment PAY: 1');
  });

  it('accepts multiple same-date document reversals, but warns on conflicting dates', async () => {
    const entries = [...reversals(), { ...reversals()[0], id: 'cogs-reversal' }];
    expect((await fixture(entries)(cutoff)).warnings).toEqual([]);
    entries[3].date = cutoff;
    const result = await fixture(entries)(cutoff);
    expect(result.documents).toEqual([]);
    expect(result.warnings).toEqual([`Historical reversal date is ambiguous for voided ${ar ? 'invoice' : 'bill'} DOC: 1; past balances cannot be confirmed`]);
    expect((await fixture(entries.reverse())(cutoff)).warnings).toEqual(result.warnings);
  });
});
