# INV-02 acceptance follow-up — 2026-10-21

Base: main `b4e6157`, including #174/#176/#177 and receipt fixes #199.
This is a bounded #170 acceptance increment, not release or historical-data certification.

## Reproduced diagnostic gap

The current-book audit compared Inventory ledger value with reviewed GL accounts
and compared warehouse quantities, but never compared stored lot carrying values.
A company could therefore have ledger = GL = 6,600 and stored carrying value 6,650
with no finding. Warehouse errors +10 / -10 could also cancel at company level.

The read-only audit now returns each item's warehouse/unassigned `carryingValue`
and `uninitializedLots` (positive-quantity lots with NULL carrying value).
`CARRYING_VALUE_MISMATCH` and `UNINITIALIZED_CARRYING_VALUE` name those problems.
It compares stored monetary carrying values, not quantity times original receipt
price; original prices deliberately differ from carrying value under WA.

Two new real-PostgreSQL regressions fail against the previous audit. They cover
legitimate unequal receipt prices after a sale, corruption despite exact ledger/GL,
offsetting warehouse errors, missing initialization and unchanged lots after the
read-only function and CLI. Existing account scope/tenant and journal checks remain.
The CLI retains database-enforced READ ONLY, repeatable-read and timeout settings.

Negative book values retain the existing negative-stock/scope review findings.
They are not compared directly with physical carrying value: tracked estimated
shortages have no physical lot. The separate `audit-weighted-average-pools.sql`
distinguishes completely tracked estimates from legacy negative pools. This change
does not certify that history or automatically initialize any NULL value.

## New PO receipt acceptance

`po-receipt-valuation-acceptance.int.test.ts` adds eight PostgreSQL cases.
Each overlap holds the winner until `pg_blocking_pids` proves the contender waits;
no timing-based assumption selects a winner.

| Overlap, both orders | Independent fixed checks |
| --- | --- |
| PO receipt / sale | Initial unassigned 5 x 1,000, incoming 3 x 2,000; selling 2 costs 2,000 before receipt or 2,750 after receipt. Six remain worth 9,000 or 8,250. |
| PO receipt / supplier return | Same costs for a physical return, booked to clearing; AP remains -5,000. Receipt credits GRIR 6,000. |
| PO receipt / FIFO-to-WA switch | Eight unassigned units remain worth 11,000, retaining original lot IDs, receipt prices and dates; no revaluation journal. |
| PO receipt / monthly close | Close-first refuses with 422 and preserves PO quantities/status, receipt, lots, draws, settlements and journals. Receipt-first posts once, then close succeeds. |

All cases retain a separate warehouse's two units at 9,000 (18,000 total), assert
lot/ledger/Inventory GL values and the trial balance. The helper-level receive
transaction composes the same period guard, PO progress and posting service as the
receive route. This does not claim a concurrent HTTP receive-route test.

## Real browser/API journeys

`e2e/inventory-valuation-acceptance.spec.ts` adds two journeys: WA throughout and
FIFO changed prospectively to WA after receiving. Both use the actual Receive
Goods dialog for 5 x 1,000 and 5 x 1,200, then send invoices through the API for
4 / 4 / 2 units. Expected cumulative COGS is 4,400 / 8,800 / 11,000; remaining
Inventory, stored carrying values and valuation endpoint are 6,600 / 2,200 / 0.

A dependent receipt's un-receive returns 422 and leaves complete PO/receipt/invoice,
lot/draw/ledger and journal snapshots unchanged. Voiding the three invoices and
un-receiving the receipts returns inventory quantity/value, Inventory GL, COGS,
AR and GRIR to zero, retains receipt identity until removal, and reopens both POs.
The method switch uses the real API and posts no revaluation journal. Invoice
creation/send/void and un-receive use APIs, not invoice/void form clicks; existing
invoice-correction browser tests remain separate coverage.

## Reproduce safely

Use a disposable PostgreSQL 16 database ending in `_test`, apply all migrations,
and generate its matching Prisma client. Never substitute a production URL.

```text
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader runner po-receipt-valuation-acceptance inventory-book-audit
node node_modules/@playwright/test/cli.js test e2e/inventory-valuation-acceptance.spec.ts e2e/purchase-receipt.spec.ts e2e/inventory-invoice-corrections.spec.ts --project chromium
```

Playwright derives a separate `_e2e` database; prepare it with
`scripts/e2e-db-setup.mjs`. Existing valuation, shortage, warehouse, carrying-value,
correction, monthly-close and fiscal-year-close tests are regression coverage.
Running the existing fiscal-year suite does not prove inventory-specific year-close
concurrency, which remains a separate acceptance gap.

## Validation on this increment

- All 20 migrations apply to fresh isolated PostgreSQL 16 databases.
- 1,353 unit tests pass; both application and e2e TypeScript projects pass.
- Full PostgreSQL run: 614 pass across 99 files; backup suites excluded because
  this Windows host lacks their required pg_dump/pg_restore tools.
- All 14 receipt/correction/valuation Chromium journeys pass.
- Frontend production build passes. Two new audit regressions fail before the fix.

This is local branch verification. CI, finance and release acceptance are separate.

## Remaining gates

- Finance-reviewed historical Inventory account set and authorized read-only runs.
- Legacy pool/NULL initialization and remediation plan, with no guessed historic COGS.
- Upgrade/backup/restore rehearsal with representative legacy data and attachments.
- Remaining PO route/concurrency matrix, inventory-specific fiscal-year/close races,
  pilot workflows and finance review. The cases above bound what was verified.
- Exact release CI, authorized migration/deployment and release smoke.

No new migration, posting/costing policy, historical rewrite, production query,
initialization, deployment or merge is performed by this increment. Keep #170 open.

# Follow-up — 2026-11-20: HTTP receive route and fiscal-year close

Closes the two concurrency gaps listed above that were code work:
`inventory-route-year-close-acceptance.int.test.ts`.

## Defect found: postings into a closed fiscal year

`closeFiscalYear` requires every *existing* period row of the year to be CLOSED,
and `assertPeriodOpen` treats a date with no period row as open. Bootstrap only
creates rows for the first fiscal year, and a closed month with no linked manual
journal can be deleted. In either case the year could be (or stay) closed while
sales, receipts and stock adjustments dated in it still posted after the closing
entry, so revenue/COGS reappeared in a closed year and Retained Earnings no
longer matched.

`lockOpenAccountingPeriod` now takes the fiscal-year advisory lock in shared
mode (close and reopen take it exclusively) before the period row, then refuses
any date covered by a `FiscalYearClose`. A posting in flight makes the close wait
and is included in it; a posting that arrives during the close waits and is
refused. The lock is taken before any period row, the same order as the close.
Reopening the year lifts the refusal. Missing period rows are still allowed to
close, as before; the guard makes that safe rather than adding a coverage rule.

## New PostgreSQL cases

| Case | Fixed checks |
| --- | --- |
| Three concurrent HTTP receives of 2 against 3 ordered | Exactly one 201, two 422 over-receive; received 2, one receipt bill, 7 units worth 9,000, GR/IR -4,000. |
| HTTP receive while a sale holds its locks | Route waits; sale costs 2,000 at the opening average; 6 units worth 9,000 after the receipt; PO closed. |
| HTTP receive while FIFO→WA holds the company row | Route waits; original lot identities and prices kept; only the receipt journal added; 8 units worth 11,000. |
| HTTP receive while the current month closes | Route waits, then 422; PO, bills, lots, ledger and journals unchanged. |
| Year with no period rows, closed | A later-dated sale and stock adjustment are refused with nothing written; the next year still posts; reopening allows the year again. |
| Closed year after deleting a closed month | The month's sale is refused. |
| Year close holding its lock vs sale / stock adjustment | Contender waits, then 422; only the closing entry is added; P&L nets to zero, RE −4,000. |
| Sale holding its locks vs year close | Close waits and includes the sale: revenue 12,000, COGS 4,000 closed, RE −8,000. |

Every case asserts lot carrying value = stock ledger = Inventory GL and a balanced
trial balance. The route cases can only hold the *other* side open, so they cover
"route arrives second"; "route first" is the sequential case already covered.

## Validation on this increment

- Unit suite and TypeScript pass, apart from the two known Windows pagination
  locale failures (`350.000`) and three `cashFlowClass` errors from a stale
  shared Prisma client in the local checkout.
- Not run against PostgreSQL locally (no database on this host); CI runs the
  integration suite.

## Remaining gates

The finance, legacy-data, rehearsal and release gates listed above are unchanged.

# Closure — 2026-11-23

#170 is closed. The app is still in development and no organisation uses it, so
go-live starts from a fresh database: opening balances and opening stock are
entered through the current code, which records lot carrying values as it posts.
The legacy gates above therefore do not apply:

- Finance-reviewed historical Inventory account set and read-only production runs:
  there is no historical data to review.
- Legacy pool / NULL carrying-value initialization: lots without a carrying value
  only exist in databases created before migration
  `20261014060000_inventory_carrying_values`, and none will be carried into go-live.

The remaining release work is not INV-02-specific and is tracked in OPS-03 (#187):
exact release CI, isolated staging upgrade, backup/restore with attachments, and
deployment smoke. If data from an existing install is ever carried into go-live,
run `scripts/audit-inventory-books.ts`, `scripts/audit-weighted-average-pools.sql`
and `scripts/preview-inventory-carrying.ts` read-only on a restored copy first
(see `docs/INV-02-CARRYING-VALUES.md`) and plan any initialization with finance.
