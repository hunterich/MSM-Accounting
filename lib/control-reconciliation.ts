import type { Prisma } from '@prisma/client';
import { asMoney, toNumber } from './money';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from './account-defaults';

type Reader = Pick<Prisma.TransactionClient, 'account' | 'organization' | 'journalLine' | 'salesInvoice' | 'bill'
  | 'aRPayment' | 'aPPayment' | 'creditNote' | 'debitNote' | 'customer' | 'vendor'>;
export type ControlKind = 'ar' | 'ap';
type DocType = 'document' | 'payment' | 'note';

export type ReconciliationItemCategory = 'DOCUMENT' | 'OPENING' | 'UNLINKED_JOURNAL' | 'UNEXPLAINED';
export interface ReconciliationItem {
  category: ReconciliationItemCategory;
  reference: string;
  date: string | null;
  entryNo?: string;
  source?: string;
  /** GL minus subledger for this item, in the control's natural sign. */
  amount: number;
  message: string;
}
export interface ControlAccountReconciliation {
  accountId: string;
  accountCode: string;
  accountName: string;
  isDefault: boolean;
  glBalance: number;
  subledgerBalance: number;
  difference: number;
  subledger: { documents: number; settlements: number; notes: number; opening: number };
  opening: { subledger: number; gl: number };
  items: ReconciliationItem[];
}
export interface ControlReconciliation {
  kind: ControlKind;
  asOf: string;
  accounts: ControlAccountReconciliation[];
  totals: { glBalance: number; subledgerBalance: number; difference: number };
}

interface Doc {
  type: DocType; number: string; status: string; date: Date; amount: number;
  override: string | null; journalId: string | null; tracked: string[]; openingSeed: boolean; clearsControl: boolean;
}
interface Line { accountId: string; description: string | null; value: number }
interface Entry { id: string; entryNo: string; date: Date; memo: string; source: string; lines: Line[] }

const LABELS = {
  ar: { document: 'Invoice', payment: 'Receipt', note: 'Credit note', control: 'AR', party: 'customer',
    memos: { 'Sales recognition': 'document', 'Void invoice': 'document', 'Re-post invoice': 'document',
      'AR receipt': 'payment', 'Void AR receipt': 'payment', 'Credit note': 'note', 'Void credit note': 'note' } },
  ap: { document: 'Bill', payment: 'Payment', note: 'Debit note', control: 'AP', party: 'vendor',
    memos: { 'Bill': 'document', 'Void bill': 'document', 'Re-post bill': 'document',
      'AP payment': 'payment', 'Void AP payment': 'payment', 'Debit note': 'note', 'Void debit note': 'note' } },
} as const;
const VOID_PREFIX = /^Void /;
const REPOST_PREFIX = /^Re-post /;
const day = (d: Date) => d.toISOString().slice(0, 10);
const nonZero = (n: number) => Math.abs(n) >= 0.005;

/**
 * Reconcile every AR or AP control account independently, as of a date.
 *
 * The subledger side is rebuilt from document amounts (invoice/bill totals,
 * receipt cash + discount - penalty, applied note values and customer/vendor
 * opening seeds), not from journal lines. Each document is expected on its
 * explicit override account, else the control its own posting used, else the
 * company default. The GL side is every posted line on those accounts. Every
 * difference is named (document posting, opening, or a journal no document
 * owns); nothing is netted across accounts and nothing is forced to balance.
 * Historical links still rely on deterministic posting memos — a structured
 * original/reversal link is a separate schema change.
 */
export async function reconcileControlAccounts(db: Reader, orgId: string, kind: ControlKind, asOf: Date): Promise<ControlReconciliation> {
  const ar = kind === 'ar';
  const labels = LABELS[kind];
  const key = ar ? 'arControl' : 'apControl';
  const [accounts, settings] = await Promise.all([
    db.account.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true } }),
    loadOrgAccountDefaults(db, orgId),
  ]);
  const defaultId = resolveAccountDefaultId(accounts.filter(a => a.isActive), settings, key)
    || resolveAccountDefaultId(accounts, settings, key);

  const notPosted = ['DRAFT', 'PENDING_APPROVAL'] as const;
  const docWhere = { organizationId: orgId, status: { notIn: [...notPosted] } };
  const [documents, payments, notes, parties] = await Promise.all([
    ar ? db.salesInvoice.findMany({ where: docWhere as Prisma.SalesInvoiceWhereInput,
      select: { number: true, status: true, issueDate: true, totalAmount: true, migrationBatchId: true, postingTracked: true, postingJournalIds: true } })
      : db.bill.findMany({ where: docWhere as Prisma.BillWhereInput,
        select: { number: true, status: true, issueDate: true, totalAmount: true, migrationBatchId: true, apAccountId: true, journalEntryId: true } }),
    ar ? db.aRPayment.findMany({ where: docWhere as Prisma.ARPaymentWhereInput,
      select: { number: true, status: true, date: true, totalAmount: true, arAccountId: true, journalEntryId: true, allocations: { select: { discountAmount: true, penaltyAmount: true } } } })
      : db.aPPayment.findMany({ where: docWhere as Prisma.APPaymentWhereInput,
        select: { number: true, status: true, date: true, totalAmount: true, apAccountId: true, journalEntryId: true, allocations: { select: { discountAmount: true, penaltyAmount: true } } } }),
    ar ? db.creditNote.findMany({ where: docWhere as Prisma.CreditNoteWhereInput,
      select: { number: true, status: true, date: true, amount: true, settlementType: true, arAccountId: true, journalEntryId: true } })
      : db.debitNote.findMany({ where: docWhere as Prisma.DebitNoteWhereInput,
        select: { number: true, status: true, date: true, amount: true, settlementType: true, apAccountId: true, journalEntryId: true } }),
    ar ? db.customer.findMany({ where: { organizationId: orgId, NOT: { openingBalance: 0 } }, select: { code: true, name: true, openingBalance: true } })
      : db.vendor.findMany({ where: { organizationId: orgId, NOT: { openingBalance: 0 } }, select: { code: true, name: true, openingBalance: true } }),
  ]);

  const docs: Doc[] = [
    ...documents.map((d): Doc => ({ type: 'document', number: d.number, status: d.status, date: d.issueDate, amount: toNumber(d.totalAmount),
      override: 'apAccountId' in d ? d.apAccountId : null, journalId: 'journalEntryId' in d ? d.journalEntryId : null,
      tracked: 'postingTracked' in d && d.postingTracked ? d.postingJournalIds : [], openingSeed: Boolean(d.migrationBatchId), clearsControl: true })),
    ...payments.map((p): Doc => ({ type: 'payment', number: p.number, status: p.status, date: p.date,
      amount: -asMoney(toNumber(p.totalAmount) + p.allocations.reduce((s, a) => s + toNumber(a.discountAmount) - toNumber(a.penaltyAmount), 0)),
      override: 'arAccountId' in p ? p.arAccountId : p.apAccountId, journalId: p.journalEntryId, tracked: [], openingSeed: false, clearsControl: true })),
    ...notes.map((n): Doc => ({ type: 'note', number: n.number, status: n.status, date: n.date, amount: -toNumber(n.amount),
      override: 'arAccountId' in n ? n.arAccountId : n.apAccountId, journalId: n.journalEntryId, tracked: [], openingSeed: false,
      clearsControl: n.settlementType === (ar ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL') })),
  ];
  const docKey = (type: DocType, number: string) => `${type}:${number}`;
  const byKey = new Map(docs.map(d => [docKey(d.type, d.number), d]));
  const byJournal = new Map<string, Doc>();
  for (const d of docs) for (const id of [d.journalId, ...d.tracked]) if (id) byJournal.set(id, d);

  // Candidate controls: defaults, document overrides, and any account that
  // received a document's tagged control line (e.g. an earlier default).
  const tags = ar ? ['AR - ', 'AR settlement - ', 'AR reduction - '] : ['AP - ', 'AP settlement - ', 'AP reduction - '];
  const tagged = await db.journalLine.findMany({ where: { entry: { organizationId: orgId, status: 'POSTED' },
    OR: tags.map(t => ({ description: { startsWith: t } })) }, distinct: ['accountId'], select: { accountId: true } });
  const controlIds = new Set([defaultId, resolveAccountDefaultId(accounts, {}, key), settings[key],
    ...docs.map(d => d.override), ...tagged.map(t => t.accountId)].filter((id): id is string => Boolean(id) && accounts.some(a => a.id === id)));

  // Later entries are loaded too: a document voided after the cutoff is still
  // open in this snapshot, which needs its later reversal to tell apart from a
  // void that was never reversed. Only entries up to asOf enter balances.
  const rawLines = await db.journalLine.findMany({
    where: { accountId: { in: [...controlIds] }, entry: { organizationId: orgId, status: 'POSTED' } },
    select: { accountId: true, description: true, debit: true, credit: true, entry: { select: { id: true, entryNo: true, date: true, memo: true, source: true } } },
  });
  const entries = new Map<string, Entry>();
  for (const l of rawLines) {
    const entry = entries.get(l.entry.id) ?? { ...l.entry, source: String(l.entry.source), lines: [] };
    const debitNormal = toNumber(l.debit) - toNumber(l.credit);
    entry.lines.push({ accountId: l.accountId, description: l.description, value: ar ? debitNormal : -debitNormal });
    entries.set(entry.id, entry);
  }

  // Link each journal to its document by stored id, else by the deterministic
  // system memo. A manual journal can never claim a document by its memo.
  const memoPattern = /^(.+?): (.+)$/;
  const linkedDoc = (e: Entry): Doc | undefined => {
    const byId = byJournal.get(e.id);
    if (byId) return byId;
    if (e.source !== 'SYSTEM' && e.source !== 'REVERSAL') return undefined;
    const match = memoPattern.exec(e.memo);
    const type = match && (labels.memos as Record<string, DocType>)[match[1]];
    return type ? byKey.get(docKey(type, match[2])) : undefined;
  };

  type Account = ControlAccountReconciliation;
  const rows = new Map<string, Account>();
  const row = (accountId: string): Account => {
    let r = rows.get(accountId);
    if (!r) {
      const a = accounts.find(x => x.id === accountId);
      r = { accountId, accountCode: a?.code ?? '', accountName: a?.name ?? 'Unknown account', isDefault: accountId === defaultId,
        glBalance: 0, subledgerBalance: 0, difference: 0, subledger: { documents: 0, settlements: 0, notes: 0, opening: 0 }, opening: { subledger: 0, gl: 0 }, items: [] };
      rows.set(accountId, r);
    }
    return r;
  };

  const docEntries = new Map<Doc, Entry[]>();
  for (const e of entries.values()) {
    const doc = linkedDoc(e);
    if (doc) docEntries.set(doc, [...(docEntries.get(doc) ?? []), e]);
    if (e.date > asOf) continue;
    for (const l of e.lines) row(l.accountId).glBalance += l.value;
    if (doc) continue;
    const byAccount = new Map<string, number>();
    for (const l of e.lines) byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) + l.value);
    for (const [accountId, value] of byAccount) {
      if (e.source === 'OPENING') { row(accountId).opening.gl += value; continue; }
      if (!nonZero(value)) continue;
      row(accountId).items.push({ category: 'UNLINKED_JOURNAL', reference: e.entryNo, entryNo: e.entryNo, source: e.source, date: day(e.date), amount: asMoney(value),
        message: `${e.source === 'MANUAL' ? 'Manual journal' : 'Journal'} ${e.entryNo} (${e.memo}) is not owned by any ${labels.party} document` });
    }
  }

  const tagFor = (d: Doc) => ar
    ? { document: `AR - ${d.number}`, payment: `AR settlement - ${d.number}`, note: `AR reduction - ${d.number}` }[d.type]
    : { document: `AP - ${d.number}`, payment: `AP settlement - ${d.number}`, note: `AP reduction - ${d.number}` }[d.type];
  const bucket = { document: 'documents', payment: 'settlements', note: 'notes' } as const;

  for (const d of docs) {
    const all = (docEntries.get(d) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime() || a.entryNo.localeCompare(b.entryNo));
    const linked = all.filter(e => e.date <= asOf);
    const originals = all.filter(e => !VOID_PREFIX.test(e.memo) && !REPOST_PREFIX.test(e.memo) && e.source !== 'REVERSAL');
    const voidDate = all.find(e => VOID_PREFIX.test(e.memo))?.date;
    const label = `${labels[d.type]} ${d.number}`;
    // Opening documents created by migration carry no journal: the opening
    // journal is their GL counterpart, so they reconcile on the opening line.
    if (d.openingSeed && !all.length) {
      if (d.date <= asOf && d.status !== 'VOID') {
        const r = row(d.override ?? defaultId); r.opening.subledger += d.amount; r.subledger.opening += d.amount;
      }
      continue;
    }
    // Same membership as aging: completed receipts/payments and applied notes
    // count even when a legacy posting is missing, so the gap is named.
    const posted = all.length > 0 || Boolean(d.journalId || d.tracked.length)
      || (d.type === 'payment' ? d.status === 'COMPLETED' : d.type === 'note' ? d.status === 'APPLIED' : true);
    const lastOriginal = originals.filter(e => e.date <= asOf).pop() ?? originals[0];
    const account = d.override ?? lastOriginal?.lines.find(l => l.description === tagFor(d))?.accountId ?? defaultId;
    const expected = new Map<string, number>();
    if (posted && d.clearsControl && (originals[0]?.date ?? d.date) <= asOf) {
      // A void never reversed did not move the subledger (as in aging); one
      // reversed after the cutoff is still open in this snapshot.
      const open = d.status !== 'VOID' || Boolean(voidDate && voidDate > asOf);
      expected.set(account, open ? d.amount : 0);
    }
    for (const [accountId, value] of expected) {
      const r = row(accountId); r.subledgerBalance += value; r.subledger[bucket[d.type]] += value;
    }
    const actual = new Map<string, number>();
    for (const e of linked) for (const l of e.lines) actual.set(l.accountId, (actual.get(l.accountId) ?? 0) + l.value);
    for (const accountId of new Set([...expected.keys(), ...actual.keys()])) {
      const diff = asMoney((actual.get(accountId) ?? 0) - (expected.get(accountId) ?? 0));
      if (!nonZero(diff)) continue;
      const exp = asMoney(expected.get(accountId) ?? 0);
      const act = asMoney(actual.get(accountId) ?? 0);
      const reason = !linked.length ? `${label} has no posting journal`
        : d.status === 'VOID' && !voidDate ?`${label} is void but its posting was never reversed`
        : !d.clearsControl ? `${label} is a refund but its posting moved the ${labels.control} control`
        : linked.some(e => REPOST_PREFIX.test(e.memo)) ? `${label} was re-posted; the current document amount differs from this snapshot's posting`
        : !expected.has(accountId) ? `${label} posted to this account instead of its ${labels.control} control`
        : `${label} posting differs from the document amount`;
      row(accountId).items.push({ category: 'DOCUMENT', reference: label, date: day(lastOriginal?.date ?? d.date), entryNo: lastOriginal?.entryNo,
        amount: diff, message: `${reason} (GL ${act}, document ${exp})` });
    }
  }

  for (const p of parties) {
    const value = toNumber(p.openingBalance);
    const r = row(defaultId); r.opening.subledger += value; r.subledger.opening += value;
  }

  const result: Account[] = [];
  for (const r of rows.values()) {
    r.opening = { subledger: asMoney(r.opening.subledger), gl: asMoney(r.opening.gl) };
    r.subledgerBalance = asMoney(r.subledgerBalance + r.opening.subledger);
    r.subledger = { documents: asMoney(r.subledger.documents), settlements: asMoney(r.subledger.settlements),
      notes: asMoney(r.subledger.notes), opening: asMoney(r.subledger.opening) };
    r.glBalance = asMoney(r.glBalance);
    r.difference = asMoney(r.glBalance - r.subledgerBalance);
    const openingDiff = asMoney(r.opening.gl - r.opening.subledger);
    if (nonZero(openingDiff)) r.items.unshift({ category: 'OPENING', reference: 'Opening balances', date: null, amount: openingDiff,
      message: `Opening journals post ${r.opening.gl}; ${labels.party} opening balances and migrated open documents total ${r.opening.subledger}` });
    const unexplained = asMoney(r.difference - r.items.reduce((s, i) => s + i.amount, 0));
    if (nonZero(unexplained)) r.items.push({ category: 'UNEXPLAINED', reference: 'Unexplained', date: null, amount: unexplained,
      message: 'Difference not attributable to a named document, opening balance or journal' });
    if (!nonZero(r.glBalance) && !nonZero(r.subledgerBalance) && !r.items.length && !r.isDefault) continue;
    result.push(r);
  }
  result.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.accountCode.localeCompare(b.accountCode));
  const total = (pick: (r: Account) => number) => asMoney(result.reduce((s, r) => s + pick(r), 0));
  return { kind, asOf: asOf.toISOString(), accounts: result,
    totals: { glBalance: total(r => r.glBalance), subledgerBalance: total(r => r.subledgerBalance), difference: total(r => r.difference) } };
}
