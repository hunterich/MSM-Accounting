import { describe, it, expect } from 'vitest';
import { computeSettlement } from '../document-settlement';

const pay = (amount: number, date = '2026-09-16') => ({ id: `p${amount}`, number: `PAY-${amount}`, date, amount });

describe('computeSettlement', () => {
  it('marks a fully paid invoice as PAID with nothing owing', () => {
    const s = computeSettlement({ total: 45220, status: 'PAID', payments: [pay(45220)], returns: [] });
    expect(s).toMatchObject({ total: 45220, paid: 45220, returned: 0, owing: 0, state: 'PAID' });
  });

  it('is OUTSTANDING when nothing has been settled', () => {
    const s = computeSettlement({ total: 983500, status: 'OPEN', payments: [], returns: [] });
    expect(s).toMatchObject({ paid: 0, owing: 983500, state: 'OUTSTANDING' });
  });

  it('is PARTIAL after a part payment and subtracts returns from owing', () => {
    const s = computeSettlement({
      total: 1000,
      status: 'SENT',
      payments: [pay(300)],
      returns: [{ id: 'r1', number: 'CN-1', date: '2026-09-17', amount: 200 }],
    });
    expect(s).toMatchObject({ paid: 300, returned: 200, owing: 500, state: 'PARTIAL' });
    expect(s.entries.map((e) => e.kind)).toEqual(['payment', 'return']);
  });

  it('becomes PAID when payments plus returns cover the total', () => {
    const s = computeSettlement({
      total: 1000,
      status: 'SENT',
      payments: [pay(800)],
      returns: [{ id: 'r1', number: 'CN-1', date: '2026-09-17', amount: 200 }],
    });
    expect(s).toMatchObject({ owing: 0, state: 'PAID' });
  });

  it('never reports a negative balance on overpayment', () => {
    const s = computeSettlement({ total: 100, status: 'PAID', payments: [pay(150)], returns: [] });
    expect(s.owing).toBe(0);
  });

  it('keeps OVERDUE while unsettled and honours VOID and DRAFT', () => {
    expect(computeSettlement({ total: 100, status: 'OVERDUE', payments: [], returns: [] }).state).toBe('OVERDUE');
    expect(computeSettlement({ total: 100, status: 'VOID', payments: [], returns: [] }).state).toBe('VOID');
    expect(computeSettlement({ total: 100, status: 'DRAFT', payments: [], returns: [] }).state).toBe('DRAFT');
  });

  it('a partly paid overdue invoice reads PARTIAL, not OVERDUE', () => {
    expect(computeSettlement({ total: 100, status: 'OVERDUE', payments: [pay(10)], returns: [] }).state).toBe('PARTIAL');
  });
});
