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
