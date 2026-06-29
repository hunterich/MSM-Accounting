# Cash & Bank Reports — Design

Date: 2026-06-29
Module: Reports → Cash & Bank
Status: Approved design, pending implementation plan

## Goal

Add three new reports under the existing **Reports → Cash & Bank** category:

1. **Bank History** (Mutasi Bank) — every bank movement over a chosen period, passbook
   style with a running balance. Optional bank filter (defaults to all banks).
2. **Detail Received per Bank** — money received by a chosen bank over a chosen period.
   Income **plus** incoming transfers.
3. **Detail Payment per Bank** — money paid out of a chosen bank over a chosen period.
   Expense **plus** outgoing transfers.

Every row in all three reports shows the **journal number**, rendered as a link. Clicking
it opens that transaction's own document form in the Banking module (Payment / Receive /
Transfer).

## Decisions (from brainstorming)

- **Transfers are included.** Received = Income + incoming transfers (`toBankAccountId` = the
  bank). Payment = Expense + outgoing transfers (`bankAccountId` = the bank). A transfer
  between two own accounts therefore appears as money-out of the source bank and money-in to
  the destination bank — consistent with a real bank book.
- **Bank History is passbook style** with opening balance, per-row running balance, and
  closing balance.
- **Bank History bank filter is optional.** Default "All banks". When all banks are selected,
  each bank renders as its own passbook section (its own opening → closing); balances are not
  interleaved across accounts (a single running balance across different accounts is
  meaningless).
- **Journal-number drill-down opens the bank transaction form** (the editable Payment /
  Receive / Transfer document), not the raw GL journal voucher.

## Data model (no migration needed)

All required fields already exist.

- `BankTransaction`: `id`, `number`, `bankAccountId`, `date`, `description`, `amount`,
  `type` (`INCOME | EXPENSE | TRANSFER`), `reference`, `payee`, `receivedFrom`,
  `toBankAccountId`, `journalEntryId`.
- `BankAccount`: `id`, `name`, `code`, `bankName`, `openingBalance`, `currentBalance`,
  `isActive`.
- `JournalEntry`: `entryNo` (the displayed journal number), linked from a bank transaction
  via `journalEntryId` / the `BankTxnJournal` relation.

### Sign convention (per account)

For a given bank account `X`, a transaction's effect on `X` is:

| Transaction | Condition | Effect on X |
| --- | --- | --- |
| INCOME | `bankAccountId = X` | money **in** (+) |
| EXPENSE | `bankAccountId = X` | money **out** (−) |
| TRANSFER (out) | `bankAccountId = X` | money **out** (−) |
| TRANSFER (in) | `toBankAccountId = X` | money **in** (+) |

## Backend

Extend the existing route `src/app/api/v1/reports/banking/route.ts` (already
`withPermission({ module: 'REPORTS', action: 'view' })`) with three new `type` branches.
Mirror the `startOfDay` / `endOfDay` date-bounding helpers used in the GL report route. Build
an `id → { name }` map of the org's bank accounts once per request to resolve transfer
counterparty names (`toBankAccountId` has no Prisma relation).

Common per-row payload fields: `bankTransactionId`, `type`, `journalEntryNo` (`entryNo` or
`null`), `txnNumber`, `date`, `description`, `reference`.

### `type=bank-history`

- Scope accounts: `bankAccountId` if provided, else all active accounts.
- For each account:
  - `openingBalance = account.openingBalance + Σ signed(txns touching the account with date < dateFrom)`.
  - `rows`: txns touching the account within `[dateFrom 00:00, dateTo 23:59:59]`, sorted by
    `date` asc then `createdAt` asc; each row carries `moneyIn`, `moneyOut`, and a
    `runningBalance` accumulated from the opening balance. Counterparty shown in the
    description column (`payee` / `receivedFrom` / the other bank's name for transfers).
  - `totalIn`, `totalOut`, `closingBalance`.
- Response: `{ banks: [{ bankAccountId, bankAccountName, bankName, accountCode, openingBalance, rows, totalIn, totalOut, closingBalance }], summary: { totalIn, totalOut, netChange } }`.
- A transfer between two in-scope accounts yields a row in each account's section (out of
  source, in to destination).

### `type=bank-received` (requires `bankAccountId`)

- `rows`: within date range AND `((INCOME AND bankAccountId = X) OR (TRANSFER AND toBankAccountId = X))`.
- Per row adds `from` = `receivedFrom`, or the source bank's name for an incoming transfer; `amount`.
- Response: `{ rows, summary: { count, totalReceived }, bankAccount: { id, name } }`.

### `type=bank-payment` (requires `bankAccountId`)

- `rows`: within date range AND `((EXPENSE AND bankAccountId = X) OR (TRANSFER AND bankAccountId = X))`.
- Per row adds `payee` = `payee`, or the destination bank's name for an outgoing transfer; `amount`.
- Response: `{ rows, summary: { count, totalPaid }, bankAccount: { id, name } }`.

## Frontend (`src/views/reports/Reports.tsx`)

### Report cards

Add three `ReportDefinition`s to `BANKING_REPORTS`, all `category: 'banking'`,
`apiPath: '/api/v1/reports/banking'`, `type: 'table'`, `filterMode: 'bank-period'`:

- `bank-history` — "Bank History", `bankRequired: false`.
- `bank-received` — "Detail Received per Bank", `bankRequired: true`.
- `bank-payment` — "Detail Payment per Bank", `bankRequired: true`.

### New filter mode `bank-period`

- Extend the `FilterMode` union and add an optional `bankRequired?: boolean` to
  `ReportDefinition`; add `bankAccountId?: string` to `ReportParams`.
- Param modal: render a date-range pair plus a bank `SearchableSelect`. When
  `bankRequired` is false, include an "All banks" option (empty `bankAccountId`); when true,
  require a selection before the run button is enabled.
- Param building: pass `dateFrom`, `dateTo`, and `bankAccountId` for this mode.
- Load bank accounts via `useBankAccounts()`.

### Rendering

- Add render branches keyed by report id:
  - `bank-history`: one block per `banks[]` entry — section header (bank name), an opening
    row, transaction rows with the running balance, and a totals/closing row.
  - `bank-received` / `bank-payment`: a flat table plus a totals row.
- Reuse existing report table styling; columns match the approved mockup
  (History: Date / Journal no. / Description / In / Out / Balance; Received: Date / Journal
  no. / From / Description / Amount; Payment: Date / Journal no. / Payee / Description /
  Amount).

### Journal-number drill-down

- Render `journalEntryNo` (fallback to `txnNumber` when null) as a link.
- On click, `navigate(\`/banking/${pathByType[type]}?txnId=${bankTransactionId}\`)` using
  React Router's `useNavigate`, where `pathByType` mirrors Banking.tsx's `targetPathByType`:
  `INCOME → 'receive'`, `EXPENSE → 'payment'`, `TRANSFER → 'transfer'`. The Banking view's
  `useDocumentTabs({ urlParam: 'txnId' })` opens the matching document form pre-loaded.

### Export & print

- Add a `buildBankingCsv(report, data)` builder for the three reports (Indonesian headers,
  consistent with the other report CSV builders), including the journal number, opening /
  closing / running balances and per-bank totals for history, and totals for received /
  payment.
- Ensure the three reports render inside the existing `react-to-print` printable area like
  the other reports.

## Testing

Backend cases in `src/app/api/v1/__tests__/reports.test.ts`:

- `bank-history`: opening balance = account opening + prior-period movements; running balance
  correctness; a transfer appears in both source and destination sections; `bankAccountId`
  scoping; summary totals.
- `bank-received`: includes income and incoming transfers, excludes expense and outgoing
  transfers; correct `count` and `totalReceived`.
- `bank-payment`: includes expense and outgoing transfers, excludes income and incoming
  transfers; correct `count` and `totalPaid`.

## Out of scope

- No schema migration (all fields already exist).
- No new RBAC key — the existing `REPORTS / view` permission covers the new types.
- No changes to how bank transactions are created or posted.
