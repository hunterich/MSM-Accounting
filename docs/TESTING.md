# Testing transactions and accounting

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
