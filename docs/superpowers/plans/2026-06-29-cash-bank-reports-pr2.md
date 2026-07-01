# Cash & Bank Reports (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Cash & Bank reports — Bank History (passbook with running balance), Detail Received per Bank, Detail Payment per Bank — each with a clickable journal-number that opens the bank transaction's form, built on PR 1's workspace catalog / `variant` structure.

**Architecture:** Three new `type` branches in the existing `reports/banking` route (no schema migration — all fields exist), plus a new `bank-period` filter mode (date range + bank picker) and three render branches in `Reports.tsx`. Transfers are included: Received = Income + incoming transfers, Payment = Expense + outgoing transfers; Bank History signs money in/out per account. The journal-number drill-down navigates to `/banking?txnId=<id>`, which the workspace shell already resolves to that transaction's doc tab.

**Tech Stack:** Next.js route handler + Prisma, React 19 + TypeScript, Vitest (`vitest run`), `tsc --noEmit`. Reference spec: `docs/superpowers/specs/2026-06-29-cash-bank-reports-design.md` (PR 2 section).

**Branch:** `claude/cash-bank-reports-pr2` (stacked on the PR 1 branch `claude/distracted-aryabhata-d4b8d7`).

---

## Sign convention (per bank account X)

| Transaction | Condition | Effect on X |
| --- | --- | --- |
| INCOME | `bankAccountId = X` | money **in** |
| EXPENSE | `bankAccountId = X` | money **out** |
| TRANSFER out | `bankAccountId = X` | money **out** |
| TRANSFER in | `toBankAccountId = X` | money **in** |

- Received (bank X) = `(INCOME & bankAccountId=X) OR (TRANSFER & toBankAccountId=X)`.
- Payment (bank X) = `(EXPENSE & bankAccountId=X) OR (TRANSFER & bankAccountId=X)`.
- History (bank X) = all of the above, signed; opening = `BankAccount.openingBalance + Σ signed(txns before dateFrom)`.

## File structure

- `src/app/api/v1/reports/banking/route.ts` (modify) — date helpers + three `type` branches + two small pure helpers.
- `src/app/api/v1/__tests__/reports.test.ts` (modify) — add `bankAccount.findMany` to the prisma mock + a `describe` block per new report type.
- `src/views/reports/Reports.tsx` (modify) — types/union, three report cards, `bank-period` param modal, `buildRequestParams` branch, run validation + state, three render branches with the journal drill-down, and three `buildBankingCsv` cases.

---

## Task 1: Backend — three report `type` branches

**Files:**
- Modify: `src/app/api/v1/reports/banking/route.ts`

- [ ] **Step 1: Add date helpers and two pure helpers above the handler**

After the imports (before `export async function OPTIONS`), add:

```ts
const startOfDay = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfDay = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

type BankTxnRow = {
  id: string; number: string | null; date: Date; description: string;
  amount: unknown; type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  reference: string | null; payee: string | null; receivedFrom: string | null;
  bankAccountId: string; toBankAccountId: string | null;
  journalEntry: { entryNo: string } | null;
};

/** Signed money-in/out a transaction has on a specific account, or null if it
 *  doesn't touch that account. */
function effectOn(t: BankTxnRow, acctId: string): { inAmt: number; outAmt: number } | null {
  const amt = Number(t.amount);
  if (t.type === 'INCOME' && t.bankAccountId === acctId) return { inAmt: amt, outAmt: 0 };
  if (t.type === 'EXPENSE' && t.bankAccountId === acctId) return { inAmt: 0, outAmt: amt };
  if (t.type === 'TRANSFER' && t.bankAccountId === acctId) return { inAmt: 0, outAmt: amt };
  if (t.type === 'TRANSFER' && t.toBankAccountId === acctId) return { inAmt: amt, outAmt: 0 };
  return null;
}

/** Human counterparty for a row, from the perspective of account acctId. */
function counterpartyOf(t: BankTxnRow, acctId: string, nameById: Map<string, string>): string {
  if (t.type === 'INCOME') return t.receivedFrom ?? '';
  if (t.type === 'EXPENSE') return t.payee ?? '';
  if (t.type === 'TRANSFER' && t.bankAccountId === acctId) return nameById.get(t.toBankAccountId ?? '') ?? '';
  if (t.type === 'TRANSFER' && t.toBankAccountId === acctId) return nameById.get(t.bankAccountId) ?? '';
  return '';
}

const TXN_SELECT = {
  id: true, number: true, date: true, description: true, amount: true, type: true,
  reference: true, payee: true, receivedFrom: true, bankAccountId: true, toBankAccountId: true, createdAt: true,
  journalEntry: { select: { entryNo: true } },
} as const;
```

- [ ] **Step 2: Read date params in the handler**

Immediately after the existing `const bankAccountId = searchParams.get('bankAccountId') ?? undefined;` line, add:

```ts
    const dateFrom = startOfDay(searchParams.get('dateFrom'));
    const dateTo = endOfDay(searchParams.get('dateTo'));
    const dateWhere = (dateFrom || dateTo)
      ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
      : {};
```

- [ ] **Step 3: Add the `bank-history` branch**

Immediately before the existing `if (type === 'reconciliation-summary') {` block, add:

```ts
    if (type === 'bank-history') {
      const accounts = await prisma.bankAccount.findMany({
        where: { organizationId: orgId, isActive: true, ...(bankAccountId ? { id: bankAccountId } : {}) },
        select: { id: true, name: true, code: true, bankName: true, openingBalance: true },
        orderBy: { name: 'asc' },
      });
      const accountIds = accounts.map((a) => a.id);
      if (accountIds.length === 0) return ok({ banks: [], summary: { totalIn: 0, totalOut: 0, netChange: 0 } });

      const allAccounts = await prisma.bankAccount.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
      const nameById = new Map(allAccounts.map((a) => [a.id, a.name] as const));

      const txns = (await prisma.bankTransaction.findMany({
        where: {
          organizationId: orgId,
          ...(dateTo ? { date: { lte: dateTo } } : {}),
          OR: [{ bankAccountId: { in: accountIds } }, { toBankAccountId: { in: accountIds } }],
        },
        select: TXN_SELECT,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })) as unknown as BankTxnRow[];

      const banks = accounts.map((acct) => {
        let opening = Number(acct.openingBalance);
        for (const t of txns) {
          const eff = effectOn(t, acct.id);
          if (eff && dateFrom && t.date < dateFrom) opening += eff.inAmt - eff.outAmt;
        }
        let running = opening;
        let totalIn = 0;
        let totalOut = 0;
        const rows = [] as Array<Record<string, unknown>>;
        for (const t of txns) {
          const eff = effectOn(t, acct.id);
          if (!eff) continue;
          if (dateFrom && t.date < dateFrom) continue;
          running += eff.inAmt - eff.outAmt;
          totalIn += eff.inAmt;
          totalOut += eff.outAmt;
          rows.push({
            bankTransactionId: t.id,
            type: t.type,
            journalEntryNo: t.journalEntry?.entryNo ?? null,
            txnNumber: t.number ?? null,
            date: t.date,
            description: t.description,
            counterparty: counterpartyOf(t, acct.id, nameById),
            reference: t.reference ?? null,
            moneyIn: eff.inAmt,
            moneyOut: eff.outAmt,
            runningBalance: running,
          });
        }
        return {
          bankAccountId: acct.id, bankAccountName: acct.name, bankName: acct.bankName, accountCode: acct.code,
          openingBalance: opening, rows, totalIn, totalOut, closingBalance: running,
        };
      });

      const summary = {
        totalIn: banks.reduce((s, b) => s + b.totalIn, 0),
        totalOut: banks.reduce((s, b) => s + b.totalOut, 0),
        netChange: banks.reduce((s, b) => s + (b.totalIn - b.totalOut), 0),
      };
      return ok({ banks, summary });
    }
```

- [ ] **Step 4: Add the `bank-received` and `bank-payment` branches**

Immediately after the `bank-history` block, add:

```ts
    if (type === 'bank-received' || type === 'bank-payment') {
      if (!bankAccountId) {
        const empty = type === 'bank-received'
          ? { rows: [], summary: { count: 0, totalReceived: 0 }, bankAccount: null }
          : { rows: [], summary: { count: 0, totalPaid: 0 }, bankAccount: null };
        return ok(empty);
      }

      const allAccounts = await prisma.bankAccount.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
      const nameById = new Map(allAccounts.map((a) => [a.id, a.name] as const));
      const bankAccount = allAccounts.find((a) => a.id === bankAccountId) ?? null;

      const or = type === 'bank-received'
        ? [{ type: 'INCOME' as const, bankAccountId }, { type: 'TRANSFER' as const, toBankAccountId: bankAccountId }]
        : [{ type: 'EXPENSE' as const, bankAccountId }, { type: 'TRANSFER' as const, bankAccountId }];

      const txns = (await prisma.bankTransaction.findMany({
        where: { organizationId: orgId, ...dateWhere, OR: or },
        select: TXN_SELECT,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })) as unknown as BankTxnRow[];

      const rows = txns.map((t) => {
        const base = {
          bankTransactionId: t.id,
          type: t.type,
          journalEntryNo: t.journalEntry?.entryNo ?? null,
          txnNumber: t.number ?? null,
          date: t.date,
          description: t.description,
          reference: t.reference ?? null,
          amount: Number(t.amount),
        };
        if (type === 'bank-received') {
          return { ...base, from: t.type === 'TRANSFER' ? (nameById.get(t.bankAccountId) ?? '') : (t.receivedFrom ?? '') };
        }
        return { ...base, payee: t.type === 'TRANSFER' ? (nameById.get(t.toBankAccountId ?? '') ?? '') : (t.payee ?? '') };
      });

      const total = rows.reduce((s, r) => s + r.amount, 0);
      const summary = type === 'bank-received'
        ? { count: rows.length, totalReceived: total }
        : { count: rows.length, totalPaid: total };
      return ok({ rows, summary, bankAccount });
    }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/reports/banking/route.ts
git commit -m "feat(reports): bank history/received/payment API branches"
```

---

## Task 2: Backend unit tests

**Files:**
- Modify: `src/app/api/v1/__tests__/reports.test.ts`

- [ ] **Step 1: Add `bankAccount` to the prisma mock**

In the `vi.mock('@/lib/prisma', ...)` object, add a `bankAccount` entry alongside `bankTransaction` (find the `bankTransaction: { findMany: vi.fn() }` entry and add before/after it):

```ts
    bankAccount: {
      findMany: vi.fn(),
    },
```

In the `beforeEach` default-empty block (where `vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([])` is), add:

```ts
  vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);
```

- [ ] **Step 2: Write the failing tests**

Append this `describe` block at the end of the file:

```ts
describe('GET /api/v1/reports/banking — cash & bank reports', () => {
  const req = (qs: string) => new NextRequest(`http://localhost/api/v1/reports/banking?${qs}`, { headers: { 'x-org-id': 'org1' } });

  it('bank-history: opening = account opening + prior movements, with running balance and transfers both directions', async () => {
    vi.mocked(prisma.bankAccount.findMany)
      // first call: scoped accounts (has openingBalance); second call: id→name map
      .mockResolvedValueOnce([{ id: 'A', name: 'BCA', code: 'BCA', bankName: 'BCA', openingBalance: 100 } as never])
      .mockResolvedValueOnce([{ id: 'A', name: 'BCA' }, { id: 'B', name: 'Mandiri' }] as never);
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([
      { id: 't0', number: 'BK0', date: new Date('2026-05-31'), description: 'prior', amount: 50, type: 'INCOME', reference: null, payee: null, receivedFrom: 'x', bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-05-31'), journalEntry: { entryNo: 'JE0' } },
      { id: 't1', number: 'BK1', date: new Date('2026-06-02'), description: 'sale', amount: 30, type: 'INCOME', reference: null, payee: null, receivedFrom: 'Cust', bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-06-02'), journalEntry: { entryNo: 'JE1' } },
      { id: 't2', number: 'BK2', date: new Date('2026-06-05'), description: 'to Mandiri', amount: 20, type: 'TRANSFER', reference: null, payee: null, receivedFrom: null, bankAccountId: 'A', toBankAccountId: 'B', createdAt: new Date('2026-06-05'), journalEntry: { entryNo: 'JE2' } },
    ] as never);

    const { GET } = await import('@/app/api/v1/reports/banking/route');
    const res = await GET(req('type=bank-history&bankAccountId=A&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.banks).toHaveLength(1);
    const bank = body.banks[0];
    expect(bank.openingBalance).toBe(150); // 100 opening + 50 prior income
    expect(bank.rows).toHaveLength(2);      // t1 (in) + t2 (transfer out); t0 excluded (prior)
    expect(bank.rows[0].moneyIn).toBe(30);
    expect(bank.rows[0].runningBalance).toBe(180);
    expect(bank.rows[1].moneyOut).toBe(20); // transfer OUT of A
    expect(bank.rows[1].runningBalance).toBe(160);
    expect(bank.closingBalance).toBe(160);
    expect(bank.totalIn).toBe(30);
    expect(bank.totalOut).toBe(20);
  });

  it('bank-received: includes income + incoming transfers, excludes payments', async () => {
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([{ id: 'A', name: 'BCA' }, { id: 'B', name: 'Mandiri' }] as never);
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([
      { id: 'r1', number: 'BK1', date: new Date('2026-06-02'), description: 'sale', amount: 30, type: 'INCOME', reference: null, payee: null, receivedFrom: 'Cust', bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-06-02'), journalEntry: { entryNo: 'JE1' } },
      { id: 'r2', number: 'BK2', date: new Date('2026-06-04'), description: 'from Mandiri', amount: 15, type: 'TRANSFER', reference: null, payee: null, receivedFrom: null, bankAccountId: 'B', toBankAccountId: 'A', createdAt: new Date('2026-06-04'), journalEntry: { entryNo: 'JE2' } },
    ] as never);

    const { GET } = await import('@/app/api/v1/reports/banking/route');
    const res = await GET(req('type=bank-received&bankAccountId=A&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.summary).toEqual({ count: 2, totalReceived: 45 });
    expect(body.rows[1].from).toBe('Mandiri'); // incoming transfer's source bank name
    expect(body.rows[0].journalEntryNo).toBe('JE1');
  });

  it('bank-payment: includes expense + outgoing transfers, with dest bank as payee', async () => {
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([{ id: 'A', name: 'BCA' }, { id: 'B', name: 'Mandiri' }] as never);
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([
      { id: 'p1', number: 'BK1', date: new Date('2026-06-03'), description: 'buy', amount: 8, type: 'EXPENSE', reference: null, payee: 'Vendor', receivedFrom: null, bankAccountId: 'A', toBankAccountId: null, createdAt: new Date('2026-06-03'), journalEntry: { entryNo: 'JE1' } },
      { id: 'p2', number: 'BK2', date: new Date('2026-06-06'), description: 'to Mandiri', amount: 20, type: 'TRANSFER', reference: null, payee: null, receivedFrom: null, bankAccountId: 'A', toBankAccountId: 'B', createdAt: new Date('2026-06-06'), journalEntry: { entryNo: 'JE2' } },
    ] as never);

    const { GET } = await import('@/app/api/v1/reports/banking/route');
    const res = await GET(req('type=bank-payment&bankAccountId=A&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.summary).toEqual({ count: 2, totalPaid: 28 });
    expect(body.rows[1].payee).toBe('Mandiri'); // outgoing transfer's destination bank name
  });

  it('bank-received returns empty when no bankAccountId given', async () => {
    const { GET } = await import('@/app/api/v1/reports/banking/route');
    const res = await GET(req('type=bank-received&dateFrom=2026-06-01&dateTo=2026-06-30'));
    const body = await res.json();
    expect(body.summary).toEqual({ count: 0, totalReceived: 0 });
    expect(body.rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/app/api/v1/__tests__/reports.test.ts`
Expected: PASS (existing tests + 4 new). If the auth-mock (`withPermission`) in this file blocks the handler, follow the pattern the other `describe` blocks use for a permitted request (the existing banking/reconciliation-less tests already call `GET` directly with an `x-org-id` header — mirror them exactly; adjust the `req` helper if the file's convention differs).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/__tests__/reports.test.ts
git commit -m "test(reports): cash & bank report branches (history/received/payment)"
```

---

## Task 3: Frontend — types, report cards, filter mode, params

**Files:**
- Modify: `src/views/reports/Reports.tsx`

- [ ] **Step 1: Extend the report-type union and FilterMode**

In the `ReportType` union, add three members (after `'bank-reconciliation'`):

```ts
  | 'bank-history'
  | 'bank-received'
  | 'bank-payment'
```

Change the `FilterMode` type to include the new mode:

```ts
export type FilterMode = 'date-range' | 'as-of' | 'inventory-snapshot' | 'statement' | 'bank-period';
```

- [ ] **Step 2: Add `bankRequired` to `ReportDefinition` and `bankAccountId` to `ReportParams`**

In `interface ReportDefinition`, add after `filterMode: FilterMode;`:

```ts
  /** bank-period reports: require a specific bank (Received/Payment) vs allow "All banks" (History). */
  bankRequired?: boolean;
```

In `interface ReportParams`, add:

```ts
  bankAccountId?: string;
```

- [ ] **Step 3: Add row/data interfaces**

After the existing `CashFlowSummary` interface, add:

```ts
export interface BankHistoryRow {
  bankTransactionId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  journalEntryNo: string | null;
  txnNumber: string | null;
  date: string;
  description: string;
  counterparty: string;
  reference: string | null;
  moneyIn: number;
  moneyOut: number;
  runningBalance: number;
}
export interface BankHistoryGroup {
  bankAccountId: string;
  bankAccountName: string;
  bankName: string | null;
  accountCode: string | null;
  openingBalance: number;
  rows: BankHistoryRow[];
  totalIn: number;
  totalOut: number;
  closingBalance: number;
}
export interface BankHistoryData { banks: BankHistoryGroup[]; summary: { totalIn: number; totalOut: number; netChange: number }; }

export interface BankDetailRow {
  bankTransactionId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  journalEntryNo: string | null;
  txnNumber: string | null;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  from?: string;   // bank-received
  payee?: string;  // bank-payment
}
export interface BankReceivedData { rows: BankDetailRow[]; summary: { count: number; totalReceived: number }; bankAccount: { id: string; name: string } | null; }
export interface BankPaymentData { rows: BankDetailRow[]; summary: { count: number; totalPaid: number }; bankAccount: { id: string; name: string } | null; }
```

- [ ] **Step 4: Add the three report cards**

Replace the `BANKING_REPORTS` array's contents by adding three entries after the existing `bank-reconciliation` entry (keep the existing two):

```ts
  {
    id: 'bank-history',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Bank History',
    description: 'Passbook of all movements per bank with a running balance (Mutasi Bank).',
    type: 'table',
    filterMode: 'bank-period',
    bankRequired: false,
  },
  {
    id: 'bank-received',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Detail Received per Bank',
    description: 'Money received by a bank in a period — income plus incoming transfers.',
    type: 'table',
    filterMode: 'bank-period',
    bankRequired: true,
  },
  {
    id: 'bank-payment',
    category: 'banking',
    apiPath: '/api/v1/reports/banking',
    name: 'Detail Payment per Bank',
    description: 'Money paid out of a bank in a period — expense plus outgoing transfers.',
    type: 'table',
    filterMode: 'bank-period',
    bankRequired: true,
  },
```

- [ ] **Step 5: Load bank accounts and add selection state**

Near the other data hooks at the top of the `Reports` component (where `useBankAccounts` can be imported), add the import at the top of the file:

```ts
import { useBankAccounts } from '../../hooks/useBanking';
```

Inside the component, alongside the other `const { data: ... }` hook calls, add:

```ts
  const { data: bankAccountsData } = useBankAccounts();
  const bankAccounts = bankAccountsData ?? [];
```

Add a state variable next to the other `useState` declarations (e.g. near `selectedAccountId`):

```ts
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
```

- [ ] **Step 6: Wire `buildRequestParams`, `openParamModal`, resets, and run validation**

In `buildRequestParams`, replace the banking/inventory branch:

```ts
    if (report.category === 'banking' || report.category === 'inventory') {
      return { type: report.id, dateFrom, dateTo };
    }
```

with:

```ts
    if (report.filterMode === 'bank-period') {
      const params: ReportParams = { type: report.id, dateFrom, dateTo };
      if (selectedBankAccountId) params.bankAccountId = selectedBankAccountId;
      return params;
    }

    if (report.category === 'banking' || report.category === 'inventory') {
      return { type: report.id, dateFrom, dateTo };
    }
```

In `openParamModal`, add near the other `if (params.xxx) setXxx(...)` lines:

```ts
    setSelectedBankAccountId(params.bankAccountId || '');
```

In `resetModalFilters` and `resetCategoryState`, add:

```ts
    setSelectedBankAccountId('');
```

In `handleRunReport`, after the existing statement/ap-statement guards, add:

```ts
    if (reportToRun.filterMode === 'bank-period' && reportToRun.bankRequired && !selectedBankAccountId) {
      setError('Pilih bank terlebih dahulu.');
      return;
    }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS (render branches for the new ids are added in Task 5; until then the reports just have no renderer — `renderReportResult` returns its fallback, which is fine for typecheck).

- [ ] **Step 8: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): cash & bank report cards + bank-period params"
```

---

## Task 4: Frontend — bank-period parameter modal

**Files:**
- Modify: `src/views/reports/Reports.tsx`

- [ ] **Step 1: Add the `bank-period` modal branch**

In the parameter `<Modal>`, the body is a `filterMode`-driven ternary chain (`paramModal.filterMode === 'statement' ? (...) : ... === 'date-range' ? (...) : ...`). Add a new arm for `bank-period` immediately before the `date-range` arm. Insert:

```tsx
            ) : paramModal.filterMode === 'bank-period' ? (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Periode &amp; Bank</div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">Dari</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">s/d</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                </div>
                <SearchableSelect
                  label={paramModal.bankRequired ? 'Bank' : 'Bank (Opsional — semua bank bila kosong)'}
                  options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  value={selectedBankAccountId}
                  onChange={(id) => setSelectedBankAccountId(id)}
                  placeholder={paramModal.bankRequired ? 'Pilih bank...' : 'Semua bank'}
                  className="mb-0"
                />
              </div>
```

(`SearchableSelect` is already imported and used elsewhere in this modal.)

- [ ] **Step 2: Disable the run button until a required bank is chosen**

Find the run button `<Button text="Tampilkan" onClick={handleRunReport} ... />` and its `disabled` expression (it already disables for `statement`/`ap-statement` without a party). Extend the disabled condition to also cover a required bank. Change:

```tsx
                  (paramModal.id === 'statement' && !selectedCustomerId) ||
                  (paramModal.id === 'ap-statement' && !selectedVendorId)
```

to:

```tsx
                  (paramModal.id === 'statement' && !selectedCustomerId) ||
                  (paramModal.id === 'ap-statement' && !selectedVendorId) ||
                  (paramModal.filterMode === 'bank-period' && paramModal.bankRequired && !selectedBankAccountId)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): bank-period parameter modal (date range + bank)"
```

---

## Task 5: Frontend — render branches + journal drill-down

**Files:**
- Modify: `src/views/reports/Reports.tsx`

- [ ] **Step 1: Add `useNavigate`**

Add the import at the top:

```ts
import { useNavigate } from 'react-router-dom';
```

Inside the component body (near the top, with the other hooks), add:

```ts
  const navigate = useNavigate();
```

- [ ] **Step 2: Add a journal-link helper inside `renderReportResult`**

At the top of the `renderReportResult` function body, add a small local renderer:

```tsx
    const journalLink = (row: { journalEntryNo: string | null; txnNumber: string | null; bankTransactionId: string }) => (
      <button
        type="button"
        onClick={() => navigate(`/banking?txnId=${row.bankTransactionId}`)}
        className="text-primary-600 underline hover:text-primary-800"
      >
        {row.journalEntryNo ?? row.txnNumber ?? '—'}
      </button>
    );
```

- [ ] **Step 3: Add the three render branches**

Immediately after the existing `if (report.id === 'cash-flow') { ... }` block (which ends before `// ── Bank Reconciliation`), add:

```tsx
    if (report.id === 'bank-history') {
      const hist = data as BankHistoryData;
      const banks = hist.banks || [];
      if (!banks.length) return renderEmptyReport('Tidak ada transaksi bank pada periode yang dipilih.');
      return (
        <div className="space-y-6">
          {banks.map((bank) => (
            <div key={bank.bankAccountId}>
              <div className="text-sm font-semibold text-neutral-800 mb-2">
                {bank.bankAccountName}{bank.bankName ? ` — ${bank.bankName}` : ''}
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="p-2 text-left font-semibold border border-neutral-300">Tanggal</th>
                    <th className="p-2 text-left font-semibold border border-neutral-300">No. Jurnal</th>
                    <th className="p-2 text-left font-semibold border border-neutral-300">Keterangan</th>
                    <th className="p-2 text-right font-semibold border border-neutral-300">Masuk</th>
                    <th className="p-2 text-right font-semibold border border-neutral-300">Keluar</th>
                    <th className="p-2 text-right font-semibold border border-neutral-300">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-neutral-50">
                    <td colSpan={5} className="p-2 border border-neutral-200 text-neutral-500">Saldo Awal</td>
                    <td className="p-2 border border-neutral-200 text-right text-neutral-600">{formatIDR(bank.openingBalance)}</td>
                  </tr>
                  {bank.rows.map((row) => (
                    <tr key={row.bankTransactionId} className="hover:bg-neutral-50">
                      <td className="p-2 border border-neutral-200">{formatDateID(row.date)}</td>
                      <td className="p-2 border border-neutral-200">{journalLink(row)}</td>
                      <td className="p-2 border border-neutral-200">
                        {row.description}{row.counterparty ? <span className="text-neutral-500"> — {row.counterparty}</span> : null}
                      </td>
                      <td className="p-2 border border-neutral-200 text-right text-success-700">{row.moneyIn ? formatIDR(row.moneyIn) : ''}</td>
                      <td className="p-2 border border-neutral-200 text-right text-danger-600">{row.moneyOut ? formatIDR(row.moneyOut) : ''}</td>
                      <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.runningBalance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold">
                    <td colSpan={3} className="p-2 border border-neutral-300">Saldo Akhir &amp; Total</td>
                    <td className="p-2 border border-neutral-300 text-right text-success-700">{formatIDR(bank.totalIn)}</td>
                    <td className="p-2 border border-neutral-300 text-right text-danger-600">{formatIDR(bank.totalOut)}</td>
                    <td className="p-2 border border-neutral-300 text-right">{formatIDR(bank.closingBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
        </div>
      );
    }

    if (report.id === 'bank-received' || report.id === 'bank-payment') {
      const isReceived = report.id === 'bank-received';
      const detail = data as BankReceivedData | BankPaymentData;
      const rows = detail.rows || [];
      if (!rows.length) return renderEmptyReport('Tidak ada transaksi pada periode yang dipilih.');
      const total = isReceived
        ? (detail as BankReceivedData).summary.totalReceived
        : (detail as BankPaymentData).summary.totalPaid;
      return (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-2 text-left font-semibold border border-neutral-300">Tanggal</th>
                <th className="p-2 text-left font-semibold border border-neutral-300">No. Jurnal</th>
                <th className="p-2 text-left font-semibold border border-neutral-300">{isReceived ? 'Dari' : 'Kepada'}</th>
                <th className="p-2 text-left font-semibold border border-neutral-300">Keterangan</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.bankTransactionId} className="hover:bg-neutral-50">
                  <td className="p-2 border border-neutral-200">{formatDateID(row.date)}</td>
                  <td className="p-2 border border-neutral-200">{journalLink(row)}</td>
                  <td className="p-2 border border-neutral-200">{isReceived ? row.from : row.payee}</td>
                  <td className="p-2 border border-neutral-200">{row.description}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-bold">
                <td colSpan={4} className="p-2 border border-neutral-300">Total ({rows.length} transaksi)</td>
                <td className="p-2 border border-neutral-300 text-right">{formatIDR(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }
```

- [ ] **Step 4: Typecheck + run the frontend tests**

Run: `npm run typecheck` (PASS), then `npm test` (all pass).

- [ ] **Step 5: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): render cash & bank reports + journal drill-down"
```

---

## Task 6: Frontend — CSV export

**Files:**
- Modify: `src/views/reports/Reports.tsx`

- [ ] **Step 1: Add the three cases to `buildBankingCsv`**

Inside `buildBankingCsv` (it already exists and handles the existing banking reports), add before its final `return '';`:

```tsx
    if (report.id === 'bank-history') {
      const hist = data as unknown as BankHistoryData;
      let csv = '';
      for (const bank of hist.banks || []) {
        csv += `${escapeCsvCell(bank.bankAccountName)}\n`;
        csv += 'Tanggal,No. Jurnal,Keterangan,Lawan Transaksi,Masuk,Keluar,Saldo\n';
        csv += `,,Saldo Awal,,,,${bank.openingBalance}\n`;
        csv += (bank.rows || []).map((row) => [
          escapeCsvCell(formatDateID(row.date)),
          escapeCsvCell(row.journalEntryNo ?? row.txnNumber ?? ''),
          escapeCsvCell(row.description),
          escapeCsvCell(row.counterparty),
          row.moneyIn,
          row.moneyOut,
          row.runningBalance,
        ].join(',')).join('\n');
        csv += `\nTotal,,,,${bank.totalIn},${bank.totalOut},${bank.closingBalance}\n\n`;
      }
      return csv.trimEnd();
    }

    if (report.id === 'bank-received' || report.id === 'bank-payment') {
      const isReceived = report.id === 'bank-received';
      const detail = data as unknown as (BankReceivedData | BankPaymentData);
      const rows = detail.rows || [];
      let csv = `Tanggal,No. Jurnal,${isReceived ? 'Dari' : 'Kepada'},Keterangan,Jumlah\n`;
      csv += rows.map((row) => [
        escapeCsvCell(formatDateID(row.date)),
        escapeCsvCell(row.journalEntryNo ?? row.txnNumber ?? ''),
        escapeCsvCell(isReceived ? (row.from ?? '') : (row.payee ?? '')),
        escapeCsvCell(row.description),
        row.amount,
      ].join(',')).join('\n');
      const total = isReceived ? (detail as BankReceivedData).summary.totalReceived : (detail as BankPaymentData).summary.totalPaid;
      csv += `\nTotal (${rows.length} transaksi),,,,${total}`;
      return csv;
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/reports/Reports.tsx
git commit -m "feat(reports): CSV export for cash & bank reports"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full typecheck + unit suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (existing + the 4 new backend tests).

- [ ] **Step 2: Manual smoke (when on a normal dev setup)**

With `VITE_WORKSPACE_TABS=1` dev server + backend:
1. Reports → Cash & Bank shows the three new cards.
2. Bank History: leave bank on "All banks", pick a period, Tampilkan → one passbook section per bank with opening → running → closing; totals reconcile.
3. Detail Received / Payment: require a bank; run → flat table with a total row; Received total = History money-in for that bank, Payment total = money-out.
4. Click a journal number → the bank transaction's doc tab opens in the Banking module.
5. Export CSV and Print both work.

- [ ] **Step 3: Commit any doc/tidy changes (if needed) — otherwise done.**

---

## Self-review notes

- **Spec coverage (PR 2):** three reports (Tasks 3-6); include-transfers sign convention (Task 1 + tests Task 2); passbook opening/running/closing (Task 1, render Task 5); optional bank for History / required for Received & Payment (Tasks 3-4); journal-number drill-down to the bank transaction form (Task 5, via `/banking?txnId=`); CSV + print (Task 6, print reuses the existing `printRef`). No schema migration; existing `REPORTS/view` permission covers the new types.
- **Deviation from spec:** the drill-down navigates to `/banking?txnId=<id>` (opens the transaction's doc tab) rather than `/banking/<type>?txnId=<id>`; the workspace shell no-ops on the type-specific paths, so the query-param form is the one that actually opens the form in both workspace and legacy modes.
- **Type consistency:** `BankHistoryData`/`BankReceivedData`/`BankPaymentData` (Task 3) are the shapes returned by the Task 1 branches and consumed by Task 5 render + Task 6 CSV; `bankAccountId` on `ReportParams` (Task 3) is set by `buildRequestParams` (Task 3) and read by the backend (Task 1).
```
