# INV-02 carrying values — unfinished implementation

Finance approved remaining book value / remaining quantity and separate warehouse
averages on 2026-10-14. Draft #171 is the earlier consumption fix. This isolated
branch builds the full value model; it is not merge-ready or deployed.

## Implemented on the branch

The additive migration `20261014060000_inventory_carrying_values` adds nullable
`InventoryLot.initialValue`, `InventoryLot.carryingValue` and
`InventoryLotDraw.costValue`. Existing receipt prices, quantities, dates and
journals are unchanged. The migration was applied only to the isolated `_test`
database; no production schema/data was changed. Legacy NULLs are not a guessed
historical backfill.

Receipts retain their original booked amount and unit price. Eligible Weighted
Average movements allocate the pool's current book value across remaining lots
in exact cents. For 5 units at 1,000 and 5 at 1,200, selling four costs 4,400 and
leaves 6,600. The original-price lots remain one unit at 1,000 and five at 1,200;
their stored carrying values become 1,100 and 5,500. No valuation journal is
created by internal allocation. The previous expected-failure test now makes
passing assertions against those actual stored values, the movement ledger and GL.

Each named warehouse has its own pool; NULL is the unassigned-stock pool.
An invoice without a specified warehouse still selects stock oldest-first, but
costs and records each actual source warehouse separately. Company reports sum
the resulting pools. POS passes the register warehouse into invoice costing so
batch stock and cost layers use the same location.

Sales record monetary costs on their lot draws. Corrections and voids restore
the original lot quantities and recorded cost, then recalculate carrying values.
New complete draws support unequal-price Weighted Average corrections; legacy
draws without monetary tracking still refuse where exact restoration cannot be
proved. The invoice notice is updated in English/Bahasa. Customer restocks use
the recorded sale cost and selected return destination, while supplier returns
use warehouse carrying cost and clearing. Financial notes remain separate.

Stock writers pin the company configuration FOR SHARE before sorted item locks
and journal numbering. Method changes hold the company FOR UPDATE, then the same
item order. Both the dedicated switch API and ordinary settings edits coordinate
through one helper. The switch preserves receipt identities and stock book value,
posts no rounding journal, and validates its effective date against period rules.
Weighted Average → FIFO freezes current lot carrying bases for future consumption.
FIFO receipt reversals refuse if a prior valuation change makes their carrying
amount differ from the original amount; they do not silently leave a difference.

## Evidence and known failure

Passing isolated tests cover five initial warehouse cases plus customer/supplier
return/void checks, mixed fulfillment, explicit warehouse refusal with document
rollback, impossible receipt removal, and real method-change/sale lock waits in
both orders. Method-switch tests cover unchanged 7,802.50 ledger/lots/GL,
unchanged receipt identities, closed periods, invalid dates, incomplete legacy
pools and FIFO exhaustion after a Weighted Average transition. POS also proves
an older, cheaper warehouse cannot supply the register's batch/cost movement.
Correction tests prove 200 and 171.43 corrected costs with exact subsequent void.

The hard compatibility regression
`weighted-average-negative-stock.int.test.ts` is currently FAILING. With negative
stock explicitly enabled, 5 units at 100 followed by a sale of 7 should preserve
the existing estimated 700 COGS / -200 inventory posting; the new positive-pool
allocator currently refuses it and rolls back. This is not marked as an expected
failure, hidden or counted as passing. Finance has been asked how a later receipt
at a different price should settle estimated cost: post the difference to COGS
on receipt while preserving the original sale, or disable negative stock for WA.
Do not merge this branch until compatibility and the selected treatment pass.

The latest broad run has 414 passing cases and exactly the negative-stock case
failing. Old correction-policy assertions have been replaced with successful
recorded-cost correction/void cases while retaining a legacy refusal regression.
The full suite must pass before review/merge readiness. Unit tests passed 1,259
cases and TypeScript passed with the new tests; the latest UI copy still needs
its final check.
No browser, full migration/recovery or production acceptance is claimed.

## Read-only diagnostic and remaining gates

Six new warehouse-scoped Weighted Average races cover customer restocking and
return voids versus a sale, in both winning orders. Returned quantity uses its
original 2,000 sale cost even after a higher-price receipt changes the pool average.
Return-first and sale-first legitimately produce different later sale costs;
each is checked against fixed expected values, exact carrying/ledger/GL and COGS,
an unchanged second warehouse and AR unaffected by restocking/void.
When a sale consumes returned lots first, void refuses; when void removes stock
first, a dependent sale refuses and remains Draft. Complete lots, monetary lot
draws, ledger, document and journal snapshots equal the winning transaction's
state after the losing transaction rolls back. Real backend lock waits are
verified. The combined warehouse/return-invariant/return-stock suite passes
24 cases. These are acceptance evidence for existing code, not a new posting
policy; supplier-return/receipt races and full month-end remain open.

Monthly-close acceptance now has two real PostgreSQL races in
`costing-switch-period-close.int.test.ts`. The winning transaction holds its
locks until the competing backend is verified blocked. Close-first refuses the
method change with 422 and preserves the complete lot snapshot; change-first
allows close after waiting. Both preserve receipt identities, all stock ledger
and journal rows, and exact lot/ledger/Inventory GL value 7,802.50. The targeted
close/method/warehouse suite passes 16 cases; TypeScript passes. This proves
monthly-close coordination for method changes, not fiscal-year closing or the
remaining receipt/return/void race matrix.

The preview CLI remains database-enforced read-only:

```text
node node_modules/tsx/dist/cli.mjs scripts/preview-inventory-carrying.ts --company COMPANY_ID --item ITEM_ID [--warehouse WAREHOUSE_ID]
```

Provide DATABASE_URL explicitly for the reviewed database. Omitted warehouse
means the unassigned pool, not a company-wide average. Output is a current-value
proposal, not authorization to initialize production or repair historic COGS.

An independent current-book diagnostic is also available:

```text
node node_modules/tsx/dist/cli.mjs scripts/audit-inventory-books.ts --company COMPANY_ID --accounts INVENTORY_ACCOUNT_ID[,OTHER_HISTORICAL_INVENTORY_ACCOUNT_ID]
```

The CLI uses a database-enforced read-only, repeatable-read transaction. Supply
the complete historical Inventory account set after finance review; today's
default does not establish that set. It independently totals all posted journal
debits minus credits and compares them with inventory ledger value. Draft journals
are excluded; inactive accounts/items and compensating reversals remain included.
Warehouse pools (including unassigned stock) separately expose physical/ledger
quantity mismatches, negative lots/stock/value and residual value without stock.
A zero company difference does not clear those warnings or certify history.
Journal lines have no warehouse identity, so no warehouse GL reconciliation is
claimed. This diagnostic neither initializes carrying values nor repairs data.
Three PostgreSQL tests exercise real receipt postings, unexplained journal value,
multiple/inactive controls, draft exclusion, tenant checks, CLI preservation and
offsetting warehouse/negative-lot defects. Together with the existing proposal's
two cases, five pass. Production has not been queried by this increment.

`scripts/audit-weighted-average-pools.sql` now checks the same separate pools and
does not require the new columns. Review any legacy unscoped/mismatched or
negative pools before an authorized release; do not guess warehouse history.

Migration transaction coordination is now isolated in draft PR #173, independent
of this schema. Thirteen new PostgreSQL overlap cases and seven existing migration
cases pass; its main-schema integration run passes 400 cases with one existing
expected failure. It covers staging/commit rechecks, zero-value dependencies,
serializable rollback, closed cutover periods and shared journal numbering.
Review/merge and migration/recovery acceptance remain pending.

Remaining gates: negative-stock posting/replenishment policy, legacy initialization
and independent GL audit, migration safeguard review/recovery, full
return/receipt/void races, period/month-end and browser acceptance, upgrade/recovery
checks and an authorized release. Nullable carrying values require explicit
initialization/diagnostics for old data; a current allocation cannot certify past
cost of sales. Issue #170 and the overall Accurate-replacement goal remain open.
