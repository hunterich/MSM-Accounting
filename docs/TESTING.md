# Testing transactions and accounting

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
| PO → receipt → bill → payment | PO form stores the correct vendor/item/quantity/price; draft and approved POs create no journal; receiving through the real API debits Inventory and credits GR/IR; the bill form clears GR/IR into AP; payment form clears AP into Cash/Bank; stock is booked once. |
| Direct inventory purchase → payment | Bill form stores quantity, price, discount and tax; Inventory 2,700 DR + Input Tax 297 DR = AP 2,997 CR; payment form debits AP and credits Cash/Bank; inventory and trial balance match; buying inventory does not immediately create an expense. |
| Expense purchase, retry and reload | Failed network submission creates no bill/journal; retry stores one draft; reopening preserves expense account, quantity, discount, additional cost, tax, withholding and notes; posting debits the selected expense accounts and input tax, credits AP and withholding payable; duplicate supplier invoice is rejected without extra records. |
| Inventory sale → customer receipt | Saved draft survives reload without posting or consuming stock; approval posts AR 3,996 DR, Sales 3,600 CR, Output Tax 396 CR, plus COGS 2,000 DR / Inventory 2,000 CR; repeat approval does not duplicate posting; receipt form settles the invoice; trial balance, P&L and balance sheet show the expected totals. |
| Sales return → credit note | Existing `e2e/returns-to-ledger.spec.ts` verifies persisted links and amounts, and now checks the exact account, debit and credit on every journal line, including the tax reversal. |

The PO receipt step is an API action, rather than an automated receipt modal.
The original network-retry test aborts before the server receives the request.
The edge-case suite also loses the response after the server commits and proves
that retrying the supplier reference cannot duplicate the bill, journal or stock.

`e2e/accounting-edge-cases.spec.ts` adds eight checks: partial PO receipts with
exact GR/IR clearing and over-receipt rollback; partial AP and AR settlement
followed by payment through the form and void through the list; bill and invoice
voids with exact reversed journal lines and restored stock; duplicate submission
after a lost response; inclusive VAT with decimal quantities, discounts and
penny rounding; closed-period rejection, view-only posting rejection and forged
company-header rejection. Partial initial payments and PO receipts use the API;
the remainder payment and void actions use the browser. The inclusive-tax case
posts through the API and reopens the saved form.

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

## Remaining coverage to extend

The journeys are representative, not exhaustive. Remaining browser coverage
includes the PO receipt modal, choosing an initial partial amount in a payment
form, tax-inclusive penny rounding entered entirely through a form, cashier
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
