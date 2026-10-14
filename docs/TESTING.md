# Testing transactions and accounting

## Weighted Average remaining book value (INV-02 first increment)

Run `npm run test:int -- weighted-average-pool` only against the disposable
PostgreSQL database. Ten cases cover the reproduced 11,000 receipt / successive
4, 4, 2 sale defect, concurrent partial sales, invoice void at recorded cost,
later receipts, exact cent exhaustion, warehouse separation and refusal of
inconsistent quantities or legacy residual values. Receipt unit prices remain
unchanged. Full posting cases assert Inventory ledger, Inventory GL, COGS and
trial balance; rounding/warehouse primitive cases assert the movement pool only.

Before an authorized release, run `scripts/audit-weighted-average-pools.sql`
read-only on each database and review any findings with finance. This diagnostic
checks company and named-warehouse quantity/value pools, including negative-stock
pools requiring separate review. It neither repairs records nor independently
reconciles the GL. Unscoped draws can leave a named warehouse inconsistent; those
named scopes refuse rather than use the wrong average. Original-price lot totals
are still not carrying values: the existing expected-failure regression remains
until the separate lot-value design and broader reversal acceptance in #170.

## Opening stock and batch receipt coordination

Opening/batch coordination is covered by
`lib/__tests__/integration/opening-batch-concurrency.int.test.ts`. Run
`npm run test:int -- opening-batch-concurrency pos-batch-stock-in pos-sale-posting import-opening-stock opening-period-guard migration-opening-stock-nogl oversell-overpay-concurrency`
against the disposable database. Nine cases prove valued receipts refuse missing
usable Inventory/Opening Equity accounts before changing new or existing batches
(the error is caught inside the transaction to verify pre-write validation),
zero-cost stock remains valid, overlapping receipts accumulate into one physical
batch, and existing opening idempotency posts once. Real overlapping opening/invoice
and batch/POS postings check fixed quantities, COGS, inventory GL and physical
batch stock, plus lot/ledger/GL reconciliation and trial balance.

Additions previously could safely report less available stock while a receipt
was uncommitted; these tests validate coordination, not a newly fixed oversell
claim. The existing migration-mode test still ensures opening stock does not
post GL twice when the migrated trial balance already includes inventory.
The batch helper is currently used for opening/setup/test data, not live AP
purchasing; its equity offset is preserved. It has no production route and does
not introduce a new purchasing flow. No production data is changed by these tests.

## Account security

Run `npm run test:security` for database-free regression tests of current session
roles, removed memberships, inactive password/Google accounts, unpredictable
temporary passwords, forced password changes, and current-role approval rules.

After preparing the disposable browser database as described below, run
`npm run test:e2e -- e2e/security-access.spec.ts e2e/auth.spec.ts`.
These tests reuse a signed-in administrator's cookie after removing or
downgrading membership, and verify the API immediately refuses old privileges.
They also create a user through the API, sign in with its temporary password,
verify business APIs are blocked, fill the real password-change form, and check
PostgreSQL and API access before disabling the account.

Run `npm audit` after dependency changes. CI rejects high/critical dependency
advisories. The lockfile is reviewed and committed with package.json; patched
transitive overrides must be checked against the frontend/backend builds.
SheetJS is pinned to the maintainer's CE 0.20.3 tarball because npm's old `xlsx`
release is vulnerable. A clean audit covers known dependency advisories, not
every possible application or deployment vulnerability.

Existing accounts that still require a password change must complete it after
upgrading. Administrators should reset any unused temporary credentials issued
by the old email-derived generator: upgrading does not rewrite existing password
hashes. These fixes take effect in the running app only after deployment.

Staff use the app normally. Developers and maintainers run the automated tests
before releasing changes; GitHub runs them on pull requests targeting `main`
and pushes to `main` or `develop`. See `.github/workflows/ci.yml`.

## What the accounting journeys check

`e2e/accounting-journeys.spec.ts` drives real forms, the real API and PostgreSQL.
Each test creates a separate company with the standard chart of accounts, its
own vendor/customer and an inventory item. Fixtures are created directly in
the disposable database; the transactions under test are submitted through the
forms/API. Assertions read the actual database, not browser cache or mocked
responses. Expected amounts are fixed examples, independent of the app's
calculation helpers. Figures illustrate test cases, not tax-rate guidance.

| Journey | Checks |
| --- | --- |
| PO → receipt → bill → payment | PO form stores the correct vendor/item/quantity/price; draft and approved POs create no journal; the receipt modal submits real PO/line IDs and debits Inventory / credits GR/IR; the bill form clears GR/IR into AP; payment form clears AP into Cash/Bank; stock is booked once. |
| Direct inventory purchase → payment | Bill form stores quantity, price, discount and tax; Inventory 2,700 DR + Input Tax 297 DR = AP 2,997 CR; payment form debits AP and credits Cash/Bank; inventory and trial balance match; buying inventory does not immediately create an expense. |
| Expense purchase, retry and reload | Failed network submission creates no bill/journal; retry stores one draft; reopening preserves expense account, quantity, discount, additional cost, tax, withholding and notes; posting debits the selected expense accounts and input tax, credits AP and withholding payable; duplicate supplier invoice is rejected without extra records. |
| Inventory sale → customer receipt | Saved draft survives reload without posting or consuming stock; approval posts AR 3,996 DR, Sales 3,600 CR, Output Tax 396 CR, plus COGS 2,000 DR / Inventory 2,000 CR; repeat approval does not duplicate posting; receipt form settles the invoice; trial balance, P&L and balance sheet show the expected totals. |
| Sales return → credit note | Existing `e2e/returns-to-ledger.spec.ts` verifies persisted links and amounts, and now checks the exact account, debit and credit on every journal line, including the tax reversal. |

`e2e/purchase-receipt.spec.ts` drives both the PO catalog receipt modal and the
Receive goods page. It checks zero/negative/excess quantities cannot submit,
fractional partial receipts omit zero lines, reopening loads remaining quantities,
and completing receipt closes the PO. Database assertions independently check
each inventory/GRIR journal and the total stock quantities/value. Run it with
`node node_modules/@playwright/test/cli.js test e2e/purchase-receipt.spec.ts --project=chromium`.

The original network-retry test aborts before the server receives the request.
The edge-case suite also loses the response after the server commits and proves
that retrying the supplier reference cannot duplicate the bill, journal or stock.

`e2e/accounting-edge-cases.spec.ts` adds eight checks: partial PO receipts with
exact GR/IR clearing and over-receipt rollback; partial AP and AR settlement
followed by payment through the form and void through the list; bill and invoice
voids with exact reversed journal lines and restored stock; duplicate submission
after a lost response; inclusive VAT with decimal quantities, discounts and
penny rounding; closed-period rejection, view-only posting rejection and forged
company-header rejection. Initial partial payments, remainder payments and void
actions use the browser; the edge-case PO receipts use the API, with separate
receipt-modal coverage. The inclusive-tax case
posts through the API and reopens the saved form.

`e2e/payment-allocation.spec.ts` checks both customer and supplier partial drafts:
invalid amounts create no payment; saving a draft creates no journal; reopening
preserves settlement, discount and fee; completing it posts the exact cash and
control-account amounts; paying the remaining balance clears the document.
Its fixed decimal example settles 600.25 using principal cash of 550.15 and a
50.10 discount, with a 10.05 fee bringing actual cash to 560.20. Both the saved
allocation and each journal line are read directly from PostgreSQL. These are
test amounts, not tax guidance. This suite is included in `test:accounting`.

`e2e/payment-safeguards.spec.ts` exercises both payment APIs against PostgreSQL:
duplicate allocations, another party's document, insufficient total cash and
discount-aware overpayment are rejected without writes. Posted payments reject
edits/deletion and allow an unchanged completion retry. Applied credit/debit
notes reduce the available balance. Two concurrent payments for the remaining
balance produce exactly one success; an older pending approval subsequently
fails without changing the approval, payment or journal. A processing payment
creates no journal and only its status-only completion can finalize it.
Unallocated advance
cash remains supported. These API checks do not certify concurrent note
application versus payment or all reversal/status-transition races.

`e2e/note-payment-concurrency.spec.ts` covers note/payment settlement races for
both AR and AP: one of two competing settlements succeeds, notes do not count
themselves twice, a completion retry posts no extra journal, void notes remain
terminal, pending notes cannot bypass approval or be edited/deleted, and draft
party edits cannot link another company's records. A stale approval fails with
the note, approval request and journal count unchanged. These checks use the
real API and PostgreSQL; broader reversal races across other document types
still need coverage. Note-aware document status has separate coverage below.

`e2e/note-settlement-status.spec.ts` verifies AR/AP Paid/reopened status with
completed payment principal plus discounts and applied linked notes. Drafts,
approval holds and monetary refunds leave debt outstanding. Real approval and
ordinary note application can complete settlement; voiding notes/payments
reopens it. Concurrent note/payment reversals both finish and leave one journal
reversal per source. Locks are acquired in document order before journal
numbering. These checks do not certify all reversal races across other modules.
Full-amount credit/debit notes also settle a document with zero payments;
voiding the note alone reopens it through the note settlement sync. The paid
document void error directs users to the applied note in this case.

`lib/__tests__/integration/backfill-note-settlement-status.int.test.ts` verifies
legacy status reconciliation against isolated PostgreSQL: dry runs persist no
changes, application is idempotent and scoped by company, and partial amounts,
refunds, pending/void notes and draft documents are excluded. Notes, payments
and journals remain unchanged.

### Return stock and reversal contention

Return stock contention is covered by
`lib/__tests__/integration/return-stock-concurrency.int.test.ts`. Run
`npm run test:int -- return-stock-concurrency return-void-invariants sales-return-original-cost void-concurrency inventory-invoice-corrections purchase-stock-concurrency`
against the disposable PostgreSQL database. Eight cases hold real transactions
uncommitted until PostgreSQL reports a blocked contender. The reversal-primitive
case catches a stale untouched-lot check followed by deletion after a sale commits,
independent of a caller's journal lock. Other cases verify consumed-stock refusal,
sale rollback after void, replacement/partial returns sharing invoice totals,
existing repeated-void protection and supplier-return restoration at recorded
cost. A draft moved and finalized against another invoice while void waits must
refuse with 409 before any VOID claim or reversal under the old invoice lock.
Fixed expected stock, inventory/COGS/control values, journal counts and
status/movement rollback reconcile lots, ledger and GL, with a balanced trial
balance. The existing returns-to-ledger browser journey retains the separate
credit-note financial treatment. No production records are amended.

### Purchase stock contention

Purchase stock contention is covered by
`lib/__tests__/integration/purchase-stock-concurrency.int.test.ts`. Run
`npm run test:int -- purchase-stock-concurrency void-concurrency edit-posted-repost gl-invariants inventory-invoice-corrections asset-purchase`
against the disposable database. Real uncommitted bill/receipt postings, voids,
corrections and sales overlap until PostgreSQL reports the waiting transaction.
Checks cover newly committed stock becoming available, exact FIFO COGS,
insufficient-stock rollback after voiding, consumed-stock refusal with unchanged
bill/PO status and journals, and replacement-item correction before a sale.
An actual PO receive-route request runs concurrently with un-receiving a prior
receipt, checking net received quantity, stock and GR/IR. All cases check lot
balances, lot/ledger/GL reconciliation and trial balance. The existing
`purchase-receipt.spec.ts` and `accounting-journeys.spec.ts` browser suites cover
receipt/finalization forms and inventory bill/sale workflows. No migration is
needed for purchase item locks.

The PO helper re-post regression holds journal numbering after reversing a
GR/IR-only bill, then starts a sale that holds the item's stock lock. The re-post
must finish without attempting that item lock, allowing the sale to proceed;
GR/IR, FIFO/COGS and remaining inventory reconcile. This exercises the helpers
directly: the edit API continues to reject posted PO-linked bill corrections.
Normal GR/IR-only bills and already-booked receipts also skip item locking;
direct bills still lock all newly written stock-layer items before journal posting.

### Stock adjustment and count contention

Run `npm run test:int -- stock-adjustment stock-count inventory-invoice-corrections`
against the disposable PostgreSQL database described below. The new
`lib/__tests__/integration/stock-adjustment-concurrency.int.test.ts` holds real
postings uncommitted and waits for PostgreSQL to report the blocked contender
before releasing them. It checks remaining FIFO layer costs after a sale or
another adjustment, a count's variance against the committed live quantity,
sale rollback after an increase is voided, and void/status rollback when the
increase has been consumed. A real create-route request contends with a count
to verify adjustment numbering finishes without a lock cycle or duplicate
numbers. Opposite-order multi-item adjustments, corrections and purchase
returns complete with exact stock/COGS/variance values. Every case checks
nonnegative lot balances, lot/ledger/GL agreement and the trial balance.

Existing adjustment/count tests retain coverage for drafts, approval holds,
warehouse scoping, mixed/net-zero adjustments, void cascades and repeat voids.
The known unequal-cost Weighted Average reconciliation case remains an
expected failure; this change preserves valuation and shortfall policies.
The existing invoice-correction browser suite also checks form/API regression.
No migration or production data update is needed for these locks.

`lib/__tests__/integration/pos-sale-posting.int.test.ts` also forces a reverse-order
batch cart to overlap a sorted stock adjustment: the adjustment holds the first
item while POS attempts it, then both must finish without a lock cycle. Exact
COGS, variance and remaining lot quantities reconcile to the GL and trial balance.
POS locks the complete materialized item set before its FEFO loop, including
ordinary items and inventory-linked modifiers.

### Posted inventory invoice corrections

Posted inventory corrections have separate coverage in
`e2e/inventory-invoice-corrections.spec.ts` and
`lib/__tests__/integration/inventory-invoice-corrections.int.test.ts`. The real
form journey edits a Sent invoice twice, reloads and voids it, verifying original
FIFO lot identity/order and net AR/COGS journals. API races cover correction
versus correction, void and receipt. Closed original/new periods, linked notes
and returns, legacy tracking and insufficient-stock failures leave the prior
document/stock/journals unchanged. PostgreSQL tests also cover replacement
items, fractional quantities and rejection of weighted-average COGS that does
not match the source-lot value. Browser checks cover the Weighted Average warning
before saving and rejection without side effects, plus correction after an applied
credit note is voided while preserving its audit record. The Weighted Average
journey also switches to Bahasa Indonesia and verifies the translated button
and notice after reload. Active credit notes and
all linked returns still block edits; return history references the original
invoice lines, which a correction replaces.

PostgreSQL coverage also checks concurrent invoice correction and purchase return
with opposite item line orders, and rollback when later differently priced
purchases make the corrected weighted-average sale differ from its lot value.
Matching-cost weighted-average corrections remain supported.

Migration `20261009060000_invoice_lot_draws` is required before using this
feature. Existing records default to untracked; the migration does not infer
historical lot draws or posting versions. New sales preserve lot draw quantities
and current journal IDs, and reversed SALES movements carry a reversal marker
so repeated corrections and later voids do not restore prior sale versions.
Editing requires exact quantity and value restoration. Negative-stock
shortfalls, missing/revalued lots and weighted-average source-lot/COGS value
differences remain void-first. Weighted-average valuation reconciliation is
still separate work. The tests do not certify every inventory race across all
modules or rebuild historical costing data.

Review follow-up verification (2026-10-09): all 1,201 unit tests, eight
invoice-correction PostgreSQL tests, 17 related reversal/return/reposting
PostgreSQL regressions and eight Chromium correction journeys passed. Both
TypeScript projects and the frontend production build passed. These checks used
isolated QA databases; production migration and deployment remain pending.

### Stale note approval recovery

Stale note-approval recovery is covered by the AR/AP journeys in
`e2e/note-payment-concurrency.spec.ts`: over-allocation leaves approval/note
pending with a reject-and-edit hint; rejection returns the note to Draft and
allows editing/deletion without posting. `note-approval-recovery.int.test.ts`
checks competing approval/rejection for both note types, requiring exactly one
consistent terminal outcome. Follow-up validation: 1,201 unit tests, 17
PostgreSQL approval checks and both Chromium recovery journeys passed.

### One-time backfill for existing note-covered documents

No schema migration is needed. Set `DATABASE_URL` explicitly to the intended
database, then preview with `npm run db:backfill-note-status`. Review the scanned
and Paid-transition counts; run `npm run db:backfill-note-status -- --apply` to
persist them. Add `--organization=<id>` to either command to limit the company.
The script processes open invoices (SENT/OVERDUE) and bills
(OPEN/PENDING/OVERDUE) with applied linked debt notes in batches of 100, then
locks and rechecks each document before using the shared settlement sync.
Dry runs take the same locks but write no records. Each document commits
separately, so an interrupted run can safely be repeated. Already Paid, draft,
approval-held and void documents are excluded; no journal entries are created.
These commands are operational instructions, not an automatic deployment step.

The three POS checks create their own stocked company and register. They verify
online cash checkout, replay protection and shift reconciliation; offline shift
and checkout syncing exactly once after reconnect and reload; and a back-office
refund of a paid POS invoice, including VAT, cash credit and UI void reversal.
The refund is a monetary credit note: it does not restock returned goods or prove
a cashier-side merchandise-return journey.

`lib/__tests__/integration/backup-restore.int.test.ts` creates accounting records,
dumps the disposable test database, restores into a fresh database and compares
accounts, bills, payments, allocations and every journal line. It also proves
the restored copy stays independent of later source changes, then removes it.

## Where to put and update tests

| Location | Use it for |
| --- | --- |
| `e2e/*.spec.ts` | User journeys across forms, API and database, including reload and navigation. |
| `lib/__tests__/*.test.ts` | Focused calculations and posting logic. Mock-based checks alone do not prove persistence. |
| `lib/__tests__/integration/*.int.test.ts` | Real PostgreSQL posting, approval, concurrency, isolation, rollback and reconciliation. |
| `src/app/api/v1/__tests__/*.test.ts` | API validation, authorization and route behavior. |
| `src/**/__tests__/*` | Frontend calculations, normalization and component behavior. |

For each bug fix, add a regression test demonstrating the failure and the
expected corrected result in the same PR. For a new transaction form, add a
representative form-to-ledger journey and cover arithmetic variations with
unit/integration tests. Assert exact accounts, each side and amounts: a balanced
journal can still be wrong. Check drafts have no unintended posting, and retries
do not duplicate journals or stock. Add the user-visible change to
`CHANGELOG.md` under `Unreleased`; document the tests run in the PR description.
Move changelog entries into a dated/versioned release when shipping them.

## Running locally

Run from the repository root with Node.js and dependencies installed. Database
tests need reachable PostgreSQL and a `DATABASE_URL` in the root `.env` or the
shell environment. Use a dedicated local QA PostgreSQL server/container whose
user can create/drop databases. Keep its connection details out of Git.

```powershell
npm install
npm run prisma:generate
npx playwright install chromium
npm run typecheck
npm run typecheck:e2e
npm test
```

Prepare the disposable databases, then run database and browser tests:

```powershell
npm run test:int:setup
npm run test:int
npm run test:e2e:setup
npm run test:accounting
# All default browser tests:
npm run test:e2e
# POS alone, or both browser projects as run in CI:
npm run test:e2e:pos
npm run test:e2e:all
```

Setup scripts **recreate** the sibling databases `<base>_test` and `<base>_e2e`.
These must contain only disposable test data. Supply the base database URL,
not an existing `_test`/`_e2e` URL, to the setup scripts. Run setup again after
migrations or when you want fresh fixtures. Playwright starts its own API on
port 3100 and frontend on port 5273; it does not need your normal dev servers.
Its database helper explicitly targets `_e2e`. Test company memberships
are removed after each test so later specs do not inherit extra companies.
Transaction evidence stays in the disposable database for debugging; rerun
setup for a clean database, especially after an interrupted run.

With pnpm, use the equivalent `pnpm run ...` commands. If this shell has Node
but no npm/pnpm command, the installed test CLIs can run directly:

```powershell
node node_modules/typescript/bin/tsc --noEmit --project tsconfig.e2e.json
node node_modules/vitest/vitest.mjs run --configLoader runner
node scripts/e2e-db-setup.mjs
node node_modules/@playwright/test/cli.js test e2e/accounting-journeys.spec.ts e2e/accounting-edge-cases.spec.ts e2e/returns-to-ledger.spec.ts --project=chromium
```

Generate Prisma before browser testing; the portable Playwright server commands
invoke the Next/Vite CLIs directly and do not run npm's pre-start hook.

Restore integration tests require PostgreSQL client tools matching the server's
major version (`pg_dump` and `pg_restore`). CI installs PostgreSQL 16 tools.
For the dedicated local container named `msm-accounting-qa-db`, the new restore
test can alternatively use its installed tools: set `QA_POSTGRES_CONTAINER` to
that exact name and `QA_DOCKER_PATH` to your Docker executable, then run this
specific test. This option does not replace native tools for other backup tests.

## Reading results

On GitHub, open the PR checks or **Actions → CI**. Confirm the main checks,
real-database integration checks and browser checks all pass before merging.
The browser job also type-checks the test files. If it fails, download the
`playwright-report` artifact; locally, run `npx playwright show-report` to inspect
the report and retry traces. Investigate failed assertions rather than changing
expected amounts just to obtain a green check.

Run the purchasing/sales smoke journeys on a staging company before deploying
a release with transaction changes. Staff can verify a small sample of draft,
posted and paid documents there, including the journal detail and reports;
automated accounting tests should not be run against their production company.

## Report reconciliation checks

Dashboard return-date regressions compare monthly sales, customer totals and
calendar buckets for full/partial returns, later-month refunds, standalone
refund notes, note voids, held/void/foreign notes and Jakarta month boundaries.
Returns reduce their credit-note period and are excluded from paid settlements;
refunds still do not settle unpaid AR. Gross notes already include PPN.

Read-only timing on an existing company: set `DATABASE_URL` for that environment,
then run `npx tsx scripts/benchmark-dashboard-sales.ts ORG_ID YYYY-MM-DD YYYY-MM-DD`.
The command reports invoice count, first-read timing, warm samples and PostgreSQL
`EXPLAIN (ANALYZE, BUFFERS)` in a read-only transaction. It seeds no fixtures and
changes no company data. Historical-company timing has not been run in this
session because the local terminal cannot start.

POS sale regressions cover configured `Kasir 1` / `Laci Kasir` drawers, sale
replay and whole-sale rollback for foreign, inactive, non-postable and non-asset
register accounts. Marketplace import regressions cover non-default `Saldo
Shopee` / `Shopee Wallet` holding assets and import replay. Payment-account
PostgreSQL checks require Banking configuration before accepting a named
non-default bank and reject invalid or mismatched internal configured-deposit
contexts. Unit checks cover the shared Banking-mapped picker/posting selector.
These regressions were added after the historical verification below; consult
CI for the current PR head.

The AR/AP account regressions in `payment-safeguards.spec.ts` cover foreign,
inactive, non-postable, wrong-type and Kasbon cash accounts; configured and
unconfigured preferred-code bank defaults; and control, discount and penalty
accounts. They check rollback at creation, draft completion and approval, valid
four-line discounted settlements, and posting retries.
`payment-posting-accounts.int.test.ts` checks the same journal-account guards
against PostgreSQL, verifies failed creations roll back, and posts a keyword-free
preferred-code bank default. Cash/default unit tests cover whole-word matching,
parent classification, preferred codes 112/111/113 and the absence of an
arbitrary-asset fallback. The verification recorded below predates these added
regressions; consult CI for the current PR head. Local execution was unavailable
because the terminal failed during workspace setup.

`dashboard-aging.int.test.ts` checks applied credit-note gross amounts, excluded
refund/draft/pending/void/foreign notes, mixed receipt/discount/note settlement,
note reversal, calendar aging boundaries and Jakarta midnight. It compares aging
to the sales widget and repeats the query in a non-UTC PostgreSQL session.
The receipt-account journey in `payment-safeguards.spec.ts` rejects foreign,
revenue, receivable, inactive and non-postable deposit accounts, checks rollback
at creation/completion/approval, and confirms valid child/default cash accounts
and unchanged posting retries. These use isolated QA databases and do not amend
historical journals.

Receipt/aging follow-up verification (2026-10-09): all 1,201 unit tests,
18 PostgreSQL checks, three payment-safeguard journeys and the existing real-form
invoice-to-receipt journey passed. Both TypeScript projects and the frontend
production build passed. The timezone check also passed after its final change.

`lib/__tests__/integration/report-reconciliation.int.test.ts` compares real
statement, aging and party-balance endpoints with posted control-account journal
lines at the same cutoff. It covers gross/tax note amounts, monetary refunds,
payment discounts and penalties, opening debt, unapplied payments and credit
balances, documents paid after the cutoff, and later-month reversals of payments,
notes and source documents. It also checks Jakarta midnight against trial balance.

`inventory-valuation-reconciliation.int.test.ts` checks both FIFO and
weighted-average snapshots, including items exhausted and deactivated after the
selected date. Stock Valuation's As of Date, AR/AP reports and GL reports use
the same Jakarta business-day boundary, independent of the server timezone.

Run these focused database checks with:

```powershell
npm run test:int -- lib/__tests__/integration/report-reconciliation.int.test.ts lib/__tests__/integration/inventory-valuation-reconciliation.int.test.ts
```

For a monthly review, compare the party-balance net total with the relevant GL
control account and compare stock valuation with the inventory GL account using
the same company, date and filters. Aging lists gross positive debt separately
from credit balances; compare its **net** position when credits exist.

Historical data limits are explicit: previous versions deleted allocations when
voiding payments, so those document links cannot be recovered automatically.
Reports show and export warnings for this case and for detected inconsistent
legacy payment/refund postings. Review the original documents and backup/audit
evidence before correcting them through approved reversal/reissue procedures.
This change does not automatically amend existing posted journals.

Manual control-account journals without a customer/vendor link, imported
opening balances without matching GL entries, and custom control-account
configuration still require reconciliation review. These checks are regression
coverage for the supported source-document paths, not a blanket certification
of all historical or imported accounting data.

## Remaining coverage to extend

The journeys are representative, not exhaustive. Remaining browser coverage
includes tax-inclusive penny rounding entered entirely through a form, cashier
merchandise returns with batch restocking, and multi-user approval workflows.
Bank imports/reconciliation, recurring transactions, payroll and assets have
backend checks but could use full browser journeys. The restore check proves
database fidelity; restoring a full deployed system, attachments and starting
the restored app still needs a staging recovery drill. Both browser projects
now run in CI; existing backend tests cover additional approval, period-lock,
isolation, settlement and concurrency cases.

## Verified locally — 2026-10-04

All 16 focused browser journeys passed together on a fresh PostgreSQL 16
test database: 13 back-office checks and three POS checks. Both application and
browser-test TypeScript checks passed. Five real-database suites passed all 15
tests covering restore, payment settlement, invoice and note reversal, and
original return costs. The note-tax posting unit suite passed all 12 tests,
including refund account selection and invalid-account rejection. The earlier
bill-posting / invoice-send-posting unit suites passed all 21 tests.

The checks exposed invoice draft-loading, tax recovery and inventory item-link
defects in the first round, then partial-payment form balances, the invoice
detail's inactive Void action and refund notes posting to AR in this round.
Regression tests cover the corrected behavior.
This records the focused checks performed, not a full-suite certification.

The subsequent reporting pass also passed 37 database tests across ten suites,
including the new reconciliation cases, all 1,134 local unit tests, both
TypeScript checks, and the same 16 accounting/POS browser journeys. Existing
posted-data problems are flagged for review rather than rewritten automatically.

## Automatic billing and finance notifications — 2026-10-08

PR #146 reliability follow-up: isolated PostgreSQL checks cover no-provider
queue suppression and baseline advancement, cancellation of unattempted messages
at 24 hours, recent delivery after setup, existing retry/idempotency behavior and
subscription invoice/journal dates on both sides of Jakarta midnight. Email tests
inject a fake sender. Catalog route checks require 400 before database access
for invalid enums, while the invoice browser journey types rapidly and verifies
only the final search is requested. Full exports, bulk alert digests and visible
run errors remain separate roadmap features.

Follow-up verification (2026-10-09): 1,215 unit tests, 22 isolated PostgreSQL
checks and four Chromium pagination journeys passed. The invoice typing/paging
journey passed again after final query normalization. Both TypeScript projects
and frontend production build passed. No real emails, production queue changes,
provider enablement or production migrations were performed.

The isolated PostgreSQL billing/notification pass covered concurrent recurring
generation, repeated-run de-duplication, draft posting safety, inactive administrator
rejection, expired templates, recurring/subscription approval regressions,
settlement-adjusted reminders, finance routing, checkpoint catch-up, concurrent
outbox leases, failure/retry idempotency, disabled-setting cancellation, missing
provider configuration and uncertain old delivery suppression. Email tests inject
a mock sender; no real emails were sent. Calendar/scheduler unit tests cover
Jakarta midnight, month-end/leap-day clamping, explicit opt-in, build suppression,
company feature toggles and isolated job failures.

Run the focused suites:

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts business-billing finance-notifications recurring-approval subscription-approval --configLoader runner
node node_modules/vitest/vitest.mjs run lib/__tests__/billing-calendar.test.ts lib/__tests__/business-automation-scheduler.test.ts --configLoader runner
```

Full browser billing/approval journeys and actual provider delivery remain release
checks. Enablement/monitoring: `docs/BUSINESS-AUTOMATION.md`. Isolated whole-system
restore remains pending: `docs/RECOVERY-DRILL.md`.

Final source verification: 1,154 unit tests and 19 focused PostgreSQL tests passed;
both TypeScript projects and frontend/backend production builds passed. The
frontend build reports existing static/dynamic import chunking warnings. The
database migration was applied only to a disposable QA container. No production
migrations, scheduler enablement, real email sends or recovery restore were performed.

## Linked return / financial note safeguards — ACC-02, 2026-10-13

`lib/__tests__/integration/linked-return-note.int.test.ts` runs 34 cases against
isolated PostgreSQL. Each scenario is covered for customer/credit notes and
supplier/debit notes. Real bill, invoice and return posting create the stock and
GL fixtures; assertions compare exact lot quantity/value, inventory ledger,
Inventory GL, COGS, AR/AP, cash, supplier-return clearing and journal counts.

Coverage includes Draft/Void return refusal, party/source/company mismatch,
create-with-APPLIED payload remaining Draft, actual PUT application/submission,
`approveRequest` and `rejectRequest` engine transactions, pending-note void
refusal, rejection then void, standalone notes, paid-source cash refunds and
note-void-then-return-void. Race tests observe PostgreSQL blocking before
releasing the first transaction: both application/void orders, both pending
submission/void orders, changed draft links after note-lock waits and changed
return identity after return-lock waits. The submission-first race calls the
same guard and approval-routing engine inside the held transaction; the
void-first race drives the actual PUT route. No timing-only race assertions.

Four sequential regressions (Draft note after return void and pending note
blocking return void, on both sides) fail against pre-fix `main` and pass with
the guards restored. Existing production data is not rewritten by this change.

```powershell
# Supply only an isolated QA database URL; the harness derives <db>_test.
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts lib/__tests__/integration/linked-return-note.int.test.ts
```

Local verification: 1,240 unit tests and 354 PostgreSQL tests pass, plus one
existing expected Weighted Average failure. Two backup suites were excluded
because this Windows environment lacks `pg_dump`; they remain CI checks.
Seven focused Chromium journeys pass (returns, note settlement and note/payment
concurrency), along with both TypeScript projects and frontend/backend builds.
The broader milestone/checklist proposal remains in separate draft PR #160;
the ACC-02 and merged INV-01 states are recorded in this branch's ROADMAP.md.

### Pre-release linked-note audit

Run `scripts/audit-linked-note-returns.sql` against each production database
before releasing #165. It uses a repeatable-read, read-only transaction and a
15-second statement timeout, then rolls back. It reports linked Draft/Pending
notes with missing returns, wrong company/party/source, or Draft/Void returns;
missing source invoice/bill IDs are included. Counts cover all matching notes;
details are capped at 200. No documents or journals are amended.

For the local Docker deployment:

```powershell
Get-Content -Raw scripts/audit-linked-note-returns.sql | docker exec -i msm-accounting-db-1 sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
```

Observed 2026-10-13 at 11:23 WIB: local production `msm_accounting` had zero
linked Draft/Pending notes and zero invalid notes. This snapshot does not cover
other servers or notes created later; rerun before deployment. If rows appear,
review with finance: reject pending requests before editing their Draft notes,
and correct the link or document intent. Do not bulk-unlink or rewrite postings.
Draft-return deletion and preservation of financial-note links is tracked in
issue #166, separately from the aggregate value-cap policy in #164.

## ACC-02 approved control/close policies — 2026-10-13

Finance approved blocking ordinary manual/bank control postings while retaining
controlled opening/migration entries, and blocking monthly close over financial
documents awaiting approval with a posting date inside the period. No automatic
redating. This is the first bounded implementation in issue #167; independent
per-control reconciliation and complete migration/month-end acceptance remain open.

`control-close-policy.int.test.ts` has 33 real PostgreSQL cases. Manual POST/PUT
and source-label spoofing cannot post to configured/auto-resolved AR/AP controls
or additional accounts explicitly designated by document overrides. Bank create
and edit use the same restriction; an edit refusal rolls back its attempted
reversal, journal and cached balance changes. Ordinary expense journals and the
actual `opening-journal` import remain available. No public source label grants
the controlled-import exemption; internal document posting is unchanged.

Close and checklist count pending financial document statuses by their posting
dates, including orphaned holds without a request. Covered: invoice, bill,
credit/debit note, AR/AP payment, sales/purchase return, stock adjustment and
payroll (period end). Other periods/companies and non-posting order approvals do
not block this month. Tests exercise rejection for all ten types and invoice
approval through the genuine engine. The same date/period-row lock governs
submission and closing; both race orders observe a PostgreSQL blocking wait
before releasing the winner. Rejected submission creates no request or journal.
Period-close logic is shared with the actual close API, not copied into tests.
Explicit invoice submission also calls the period guard inside its transaction,
and checks Draft only after obtaining the invoice row lock. Seven review
regressions cover closed-month refusal (fails against the pre-fix route), both
submission/close race orders, posting winning before submission, duplicate
submissions, existing-request reuse and cross-company refusal. Explicit approval
submission remains available with automatic routing disabled. The shared
submission helper is the actual route's implementation, not a test-only copy.

Two focused regressions fail against pre-fix main (manual AR posting and closing
over an in-period pending invoice). Existing approval, return, opening and bank
regressions pass. Full local suites: 1,240 unit tests and 387 PostgreSQL tests,
plus the existing expected Weighted Average failure; two backup suites are
excluded locally because `pg_dump` is unavailable and remain CI checks.

Fifteen focused Chromium cases passed across the initial run and a focused rerun
(accounting journeys/edge cases, period close and the two new policy cases).
The initial run had two sign-in timeouts and a new exact-text locator miss;
the locator and account fixture names were corrected, and all three cases passed
on rerun. New UI coverage proves the close button is disabled for an in-period
hold, the API also refuses, and rejection allows close; authenticated manual
source spoofing refuses while an ordinary expense journal posts. Both TypeScript
projects and frontend/backend builds are checked. English/Bahasa close guidance
uses the translation function. No production postings, period changes, data
rewrites, migration or deployment were performed.
After the explicit invoice-route fix, all four focused browser cases pass
together: close guidance/rejection, ordinary manual posting policy, explicit
invoice submission/rejection followed by closed-month refusal, and the existing
monthly close/reopen journey. Both TypeScript projects and the backend build
are rechecked for that change. Additional document offset/refund account-role
validation remains a separate follow-up in issue #169.

Before release, finance should review existing direct-control GL differences
and any financial holds already dated in closed months. The new rules do not
repair historical postings or silently redate pending documents.

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts control-close-policy period-close approval-engine bank-transaction linked-return-note
node node_modules/@playwright/test/cli.js test e2e/control-close-policy.spec.ts e2e/period-close.spec.ts --project=chromium
```
