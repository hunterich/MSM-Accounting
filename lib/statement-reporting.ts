// Pure statement-of-account math, shared by the AR (customer) and AP (vendor)
// statement reports. No Prisma/DB dependency: each route shapes its query
// results into these inputs and calls these functions, which keeps the
// correctness-critical arithmetic isolated and directly unit-testable.

const asMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** One movement on a party's account. A `debit` raises the balance the statement
 *  tracks (AR: what the customer owes us; AP: what we owe the vendor); a `credit`
 *  lowers it. `order` breaks ties between transactions on the same day. */
export interface StatementTxn {
  date: Date;
  type: string;
  number: string;
  debit: number;
  credit: number;
  order: number;
}

export interface StatementRow {
  date: string; // ISO
  type: string;
  number: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface StatementComputation {
  openingBalance: number;
  rows: StatementRow[];
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
}

/** Fold transactions dated before `periodStart` into the opening balance, then
 *  lay out the in-period transactions chronologically with a running balance. */
export function computeStatement(opts: {
  openingSeed: number;
  txns: StatementTxn[];
  periodStart: Date;
  periodEnd: Date;
}): StatementComputation {
  const startMs = opts.periodStart.getTime();
  const endMs = opts.periodEnd.getTime();

  let opening = opts.openingSeed;
  const inPeriod: StatementTxn[] = [];
  for (const t of opts.txns) {
    const ms = t.date.getTime();
    if (ms < startMs) opening += t.debit - t.credit;
    else if (ms <= endMs) inPeriod.push(t);
  }
  opening = asMoney(opening);

  inPeriod.sort((a, b) => (a.date.getTime() - b.date.getTime()) || (a.order - b.order));

  let running = opening;
  let totalDebits = 0;
  let totalCredits = 0;
  const rows: StatementRow[] = inPeriod.map((t) => {
    running = asMoney(running + t.debit - t.credit);
    totalDebits = asMoney(totalDebits + t.debit);
    totalCredits = asMoney(totalCredits + t.credit);
    return {
      date: t.date.toISOString(),
      type: t.type,
      number: t.number,
      debit: t.debit,
      credit: t.credit,
      runningBalance: running,
    };
  });

  return { openingBalance: opening, rows, totalDebits, totalCredits, closingBalance: running };
}

export interface AgingBuckets {
  current: number;
  d1To30: number;
  d31To60: number;
  d61To90: number;
  d90Plus: number;
}

/** A still-open document (invoice/bill) used to age the closing balance. */
export interface OpenDocument {
  dueDate: Date | null;
  balance: number;
}

const daysOverdue = (dueDate: Date | null, asOf: Date): number => {
  if (!dueDate) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((asOf.getTime() - dueDate.getTime()) / msPerDay));
};

/** Bucket open document balances by how far past due they are as of `asOf`. */
export function computeAging(docs: OpenDocument[], asOf: Date): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, d1To30: 0, d31To60: 0, d61To90: 0, d90Plus: 0 };
  for (const doc of docs) {
    if (doc.balance <= 0) continue;
    const d = daysOverdue(doc.dueDate, asOf);
    if (d <= 0) buckets.current = asMoney(buckets.current + doc.balance);
    else if (d <= 30) buckets.d1To30 = asMoney(buckets.d1To30 + doc.balance);
    else if (d <= 60) buckets.d31To60 = asMoney(buckets.d31To60 + doc.balance);
    else if (d <= 90) buckets.d61To90 = asMoney(buckets.d61To90 + doc.balance);
    else buckets.d90Plus = asMoney(buckets.d90Plus + doc.balance);
  }
  return buckets;
}
