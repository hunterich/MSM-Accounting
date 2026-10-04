import type { Prisma } from '@prisma/client';
import { asMoney, toNumber } from './money';
import type { StatementTxn } from './statement-reporting';

type Reader = Pick<Prisma.TransactionClient, 'journalEntry' | 'aRPayment' | 'aPPayment' | 'creditNote' | 'debitNote'>;
type Kind = 'ar' | 'ap';
interface Document { id: string; number: string; issueDate: Date; totalAmount: unknown; status: string }

/** Date-only report filters use the Jakarta business day, independent of server TZ. */
export function reportDate(value: string | null, end: boolean): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const day = value ?? `${part('year')}-${part('month')}-${part('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(day).getTime()) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error(`Invalid date: ${value}`);
  const start = new Date(`${day}T00:00:00+07:00`);
  return end ? new Date(start.getTime() + 86_400_000 - 1) : start;
}

/**
 * Reconstruct positions from original postings and dated reversals, not today's
 * document status. Allocations on voided payments are retained for this history.
 * Legacy voids that already deleted their allocations cannot be reconstructed
 * per document and are reported as warnings rather than silently certified.
 */
export async function readSubledgerHistory<T extends Document>(
  db: Reader, kind: Kind, orgId: string, documents: T[], asOf: Date, partyId?: string,
) {
  const ar = kind === 'ar';
  const paymentWhere = { organizationId: orgId, date: { lte: asOf },
    ...(partyId ? ar ? { customerId: partyId } : { vendorId: partyId } : {}) };
  const [payments, notes] = await Promise.all([
    ar ? db.aRPayment.findMany({ where: paymentWhere, include: { allocations: true } })
      : db.aPPayment.findMany({ where: paymentWhere, include: { allocations: true } }),
    ar ? db.creditNote.findMany({ where: paymentWhere }) : db.debitNote.findMany({ where: paymentWhere }),
  ]);
  const docVoid = (number: string) => `Void ${ar ? 'invoice' : 'bill'}: ${number}`;
  const payVoid = (number: string) => `Void ${ar ? 'AR receipt' : 'AP payment'}: ${number}`;
  const noteVoid = (number: string) => `Void ${ar ? 'credit note' : 'debit note'}: ${number}`;
  const memos = [...documents.filter(d => d.status === 'VOID').map(d => docVoid(d.number)),
    ...payments.filter(p => p.status === 'VOID').map(p => payVoid(p.number)), ...notes.filter(n => n.status === 'VOID').map(n => noteVoid(n.number))];
  const journalIds = [...payments, ...notes].flatMap(p => p.journalEntryId ? [p.journalEntryId] : []);
  // Keep each query below PostgreSQL's bind-parameter limit on large ledgers.
  const batchSize = 10_000;
  const entries = (await Promise.all(Array.from({ length: Math.max(1, Math.ceil(Math.max(memos.length, journalIds.length) / batchSize)) }, (_, i) =>
    db.journalEntry.findMany({ where: { organizationId: orgId, status: 'POSTED',
      OR: [{ source: 'REVERSAL', memo: { in: memos.slice(i * batchSize, (i + 1) * batchSize) } }, { id: { in: journalIds.slice(i * batchSize, (i + 1) * batchSize) } }] },
      select: { id: true, memo: true, source: true, date: true, lines: { select: { description: true, debit: true, credit: true } } } })))).flat();
  const journal = new Map(entries.map(e => [e.id, e]));
  const reversalDates = new Map(entries.filter(e => e.source === 'REVERSAL').map(e => [e.memo, e.date]));
  const warnings: string[] = [];
  const active = (status: string, memo: string) => status !== 'VOID' || Boolean(reversalDates.get(memo) && reversalDates.get(memo)! > asOf);
  const txns: StatementTxn[] = [];
  const movement = (date: Date, number: string, type: string, amount: number, credit: boolean, reversal?: Date) => {
    txns.push({ date, number, type, debit: credit ? 0 : amount, credit: credit ? amount : 0, order: credit ? 1 : 0 });
    if (reversal && reversal <= asOf) txns.push({ date: reversal, number, type: `Void ${type}`, debit: credit ? amount : 0, credit: credit ? 0 : amount, order: 2 });
  };
  const postedDocs = documents.filter(d => !['DRAFT', 'PENDING_APPROVAL'].includes(d.status) &&
    (d.status !== 'VOID' || reversalDates.has(docVoid(d.number))));
  for (const d of postedDocs) movement(d.issueDate, d.number, ar ? 'Invoice' : 'Bill', toNumber(d.totalAmount), false, reversalDates.get(docVoid(d.number)));
  const cleared = new Map<string, number>();
  const unallocated = new Map<string, number>();
  const addCredit = (party: string, amount: number) => unallocated.set(party, asMoney((unallocated.get(party) ?? 0) + amount));
  const add = (id: string, amount: number) => cleared.set(id, asMoney((cleared.get(id) ?? 0) + amount));
  for (const p of payments) {
    if (!p.journalEntryId && p.status !== 'COMPLETED') continue;
    const date = journal.get(p.journalEntryId ?? '')?.date ?? p.date;
    if (date > asOf) continue;
    const discount = p.allocations.reduce((s, a) => s + toNumber(a.discountAmount), 0);
    const penalty = p.allocations.reduce((s, a) => s + toNumber(a.penaltyAmount), 0);
    const expectedClearing = asMoney(toNumber(p.totalAmount) + discount - penalty);
    const controlLine = journal.get(p.journalEntryId ?? '')?.lines.find(l => l.description?.startsWith(ar ? 'AR settlement - ' : 'AP settlement - '));
    const postedClearing = controlLine ? toNumber(ar ? controlLine.credit : controlLine.debit) : expectedClearing;
    if (asMoney(postedClearing) !== expectedClearing) warnings.push(`Payment ${p.number} journal and settlement adjustments differ; review the original posting`);
    movement(date, p.number, 'Payment', postedClearing, true, reversalDates.get(payVoid(p.number)));
    if (p.status === 'VOID' && active(p.status, payVoid(p.number)) && !p.allocations.length) warnings.push(`Historical allocation unavailable for voided payment ${p.number}`);
    if (active(p.status, payVoid(p.number))) for (const a of p.allocations) {
      const id = 'invoiceId' in a ? a.invoiceId : a.billId;
      add(id, toNumber(a.amountApplied) + toNumber(a.discountAmount));
    }
    if (active(p.status, payVoid(p.number))) addCredit('customerId' in p ? p.customerId : p.vendorId,
      toNumber(p.totalAmount) + discount - penalty - p.allocations.reduce((s, a) => s + toNumber(a.amountApplied) + toNumber(a.discountAmount), 0));
  }
  for (const n of notes) {
    if (n.settlementType === (ar ? 'REFUND' : 'REFUND_FROM_VENDOR') && journal.get(n.journalEntryId ?? '')?.lines.some(l => l.description?.startsWith(ar ? 'AR reduction - ' : 'AP reduction - '))) {
      warnings.push(`Refund ${n.number} was posted to ${ar ? 'AR' : 'AP'} instead of cash; review and reverse/reissue the original posting`);
    }
    if (n.settlementType !== (ar ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL') || (!n.journalEntryId && n.status !== 'APPLIED')) continue;
    const date = journal.get(n.journalEntryId ?? '')?.date ?? n.date;
    if (date > asOf) continue;
    movement(date, n.number, ar ? 'Credit Note' : 'Debit Note', toNumber(n.amount), true, reversalDates.get(noteVoid(n.number)));
    const id = 'sourceInvoiceId' in n ? n.sourceInvoiceId : n.sourceBillId;
    if (id && active(n.status, noteVoid(n.number))) add(id, toNumber(n.amount));
    if (!id && active(n.status, noteVoid(n.number))) addCredit('customerId' in n ? n.customerId : n.vendorId, toNumber(n.amount));
  }
  return { documents: postedDocs.filter(d => active(d.status, docVoid(d.number))), cleared, unallocated, txns, warnings };
}
