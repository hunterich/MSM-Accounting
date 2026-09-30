// How much of an invoice / bill has been settled, and what is still owed.
// Shared by the sales-invoice and purchase-bill settlement endpoints so both
// screens (and the UI stamp) agree on a single definition.

export type SettlementState = 'DRAFT' | 'VOID' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'OUTSTANDING';

export interface SettlementEntry {
  id: string;
  number: string;
  date: string;
  amount: number;
  kind: 'payment' | 'return';
}

export interface SettlementSummary {
  total: number;
  paid: number;
  returned: number;
  owing: number;
  state: SettlementState;
  entries: SettlementEntry[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface Input {
  total: number;
  /** Document status as stored (e.g. DRAFT, SENT, OPEN, PAID, OVERDUE, VOID). */
  status: string;
  /** Cash applied to the document: amount applied + settlement discount. */
  payments: { id: string; number: string; date: Date | string; amount: number }[];
  /** Credit / debit notes applied against the document. */
  returns: { id: string; number: string; date: Date | string; amount: number }[];
}

const toIso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : String(d));

export function computeSettlement({ total, status, payments, returns }: Input): SettlementSummary {
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  const returned = round2(returns.reduce((s, r) => s + r.amount, 0));
  const owing = round2(Math.max(total - paid - returned, 0));

  const st = status.toUpperCase();
  let state: SettlementState;
  if (st === 'VOID') state = 'VOID';
  else if (st === 'DRAFT' || st === 'PENDING_APPROVAL') state = 'DRAFT';
  else if (total > 0 && owing === 0) state = 'PAID';
  else if (st === 'PAID') state = 'PAID';
  else if (paid + returned > 0) state = 'PARTIAL';
  else if (st === 'OVERDUE') state = 'OVERDUE';
  else state = 'OUTSTANDING';

  const entries: SettlementEntry[] = [
    ...payments.map((p) => ({ id: p.id, number: p.number, date: toIso(p.date), amount: round2(p.amount), kind: 'payment' as const })),
    ...returns.map((r) => ({ id: r.id, number: r.number, date: toIso(r.date), amount: round2(r.amount), kind: 'return' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return { total: round2(total), paid, returned, owing, state, entries };
}
