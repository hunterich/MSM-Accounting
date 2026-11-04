import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { lockEligibleNoteReturn } from '../note-return-eligibility';
import { linkedReturnValue } from '../note-return-value';
import { auditLinkedReturnLimits } from '../note-return-audit';

const d = (value: string | number) => new Prisma.Decimal(value);
function fixture(kind: 'credit' | 'debit', used = '0', total = '111.00') {
  const source = { invoiceId: 'source', quantity: d(2), lineSubtotal: d(200) };
  const ret = { status: 'APPROVED', customerId: 'party', vendorId: 'party', invoiceId: 'source', billId: 'source',
    totalAmount: d(total), applyTax: true, taxIncluded: false, taxRate: d(11),
    invoice: { discountAmount: d(0), subtotal: d(200), taxEnabled: true, taxInclusive: false, taxRate: d(11) },
    lines: [{ qtyReturn: d(1), price: d(100), sourceInvoiceLine: source }] };
  const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: d(used) } });
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]),
    salesReturn: { findFirst: vi.fn().mockResolvedValue(ret), findFirstOrThrow: vi.fn().mockResolvedValue(ret) },
    purchaseReturn: { findFirst: vi.fn().mockResolvedValue(ret), findFirstOrThrow: vi.fn().mockResolvedValue(ret) },
    creditNote: { aggregate }, debitNote: { aggregate } };
  const note = { id: 'current', amount: '111.00', organizationId: 'org', partyId: 'party', sourceId: 'source', returnId: 'return' };
  return { tx: tx as unknown as Prisma.TransactionClient, raw: tx, ret, note, aggregate,
    check: (amount = note.amount) => lockEligibleNoteReturn(tx as unknown as Prisma.TransactionClient, kind, { ...note, amount }) };
}

for (const kind of ['credit', 'debit'] as const) describe(`${kind} return limits`, () => {
  it('accepts exact gross and rejects one cent over, without floating point tolerance', async () => {
    const f = fixture(kind, '100.90');
    await expect(f.check('10.10')).resolves.toBeUndefined();
    await expect(f.check('10.11')).rejects.toThrow('available 10.10');
    expect(f.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      organizationId: 'org', id: { not: 'current' }, status: { in: ['APPLIED', 'PENDING_APPROVAL'] },
    }) }));
  });
  it('does not query or reserve value for standalone notes', async () => {
    const f = fixture(kind);
    await lockEligibleNoteReturn(f.tx, kind, { ...f.note, returnId: null });
    expect(f.raw.$queryRaw).not.toHaveBeenCalled();
    expect(f.aggregate).not.toHaveBeenCalled();
  });
  it('blocks historical excess and inconsistent recorded valuations', async () => {
    await expect(fixture(kind, '112').check('0.01')).rejects.toThrow('available 0.00');
    await expect(fixture(kind, '0', '999').check()).rejects.toThrow('finance review');
  });
  it('counts tax-inclusive and non-taxable returns correctly', async () => {
    const f = fixture(kind, '0', '100');
    f.ret.taxIncluded = true; f.ret.invoice.taxInclusive = true;
    await expect(f.check('100')).resolves.toBeUndefined();
    f.ret.applyTax = false; f.ret.invoice.taxEnabled = false;
    await expect(f.check('100')).resolves.toBeUndefined();
  });
});

describe('return valuation basis', () => {
  it('uses original sale less line and invoice discounts', async () => {
    const f = fixture('credit', '0', '79.92');
    f.ret.lines[0].sourceInvoiceLine.lineSubtotal = d(160); // 20% line discount
    f.ret.invoice.subtotal = d(160); f.ret.invoice.discountAmount = d(16); // 10% header discount
    expect((await linkedReturnValue(f.tx, 'credit', 'org', 'return')).toFixed(2)).toBe('79.92');
  });
  it('uses agreed supplier return price rather than original bill cost', async () => {
    const f = fixture('debit', '0', '133.20');
    f.ret.lines[0].price = d(120);
    expect((await linkedReturnValue(f.tx, 'debit', 'org', 'return')).toFixed(2)).toBe('133.20');
  });
  it('requires finance review when historical source invoice lines are missing', async () => {
    const f = fixture('credit');
    f.ret.lines[0].sourceInvoiceLine.invoiceId = 'wrong-invoice';
    await expect(f.check()).rejects.toThrow('finance review');
  });
});

describe('historical return limit audit', () => {
  function auditFixture() {
    const f = fixture('debit');
    const notes = [
      { id: 'applied', number: 'DN-1', amount: d(60), status: 'APPLIED', settlementType: 'REFUND_FROM_VENDOR' },
      { id: 'reserved', number: 'DN-2', amount: d(52), status: 'PENDING_APPROVAL', settlementType: 'APPLY_TO_BILL' },
    ];
    const purchaseReturn = { findMany: vi.fn().mockResolvedValue([{ id: 'ret', number: 'PR-1', totalAmount: d(111) }]),
      findFirstOrThrow: vi.fn().mockResolvedValue(f.ret) };
    const tx = { salesReturn: { findMany: vi.fn().mockResolvedValue([]) }, purchaseReturn,
      debitNote: { findMany: vi.fn().mockResolvedValue(notes) } };
    return { tx, typed: tx as unknown as Prisma.TransactionClient, ret: f.ret };
  }
  it('reports applied refunds and reservations separately and scopes every query to the company', async () => {
    const f = auditFixture();
    const report = await auditLinkedReturnLimits(f.typed, 'org');
    expect(report.findings).toEqual([expect.objectContaining({ returnId: 'ret', applied: '60.00', reserved: '52.00', excess: '1.00' })]);
    expect(f.tx.debitNote.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      organizationId: 'org', purchaseReturnId: 'ret', status: { in: ['APPLIED', 'PENDING_APPROVAL'] },
    } }));
    expect(f.tx.purchaseReturn.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ret', organizationId: 'org' } }));
  });
  it('reports inconsistent valuations without changing recorded amounts', async () => {
    const f = auditFixture();
    f.ret.lines[0].price = d(101);
    const report = await auditLinkedReturnLimits(f.typed, 'org');
    expect(report.findings[0]).toMatchObject({ returnValue: '111.00', valuationError: expect.stringContaining('finance review') });
    expect(f.ret.totalAmount.toFixed(2)).toBe('111.00');
  });
  it('propagates database failures rather than issuing a misleading partial report', async () => {
    const f = auditFixture();
    f.tx.purchaseReturn.findFirstOrThrow.mockRejectedValue(new Error('database unavailable'));
    await expect(auditLinkedReturnLimits(f.typed, 'org')).rejects.toThrow('database unavailable');
  });
});
