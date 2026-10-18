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
FIFO retains its carrying-versus-original-value guard. WA instead removes original
value when no later stock issue exists for that item and warehouse; later receipts
at different prices do not prevent voiding. No receipt-void COGS policy is added.

## Review correction: actual posting order on inbound voids (2026-10-16)

Commit 82405a4's carrying-value guard was too broad for WA: mixed-price receipts
alone redistribute carrying values. That commit also incorrectly changed the
original-cost return test to expect an immediate void refusal. The test now again
requires the legitimate immediate void to succeed.

WA reversal now checks the exact inbound movement under the item lock and
refuses a later outbound for the same item/warehouse, naming its document. It
otherwise removes the original value and reallocates the remaining pool. Bill,
customer-return and adjustment sell-four/sell-five cases still refuse with exact
rollback, even when the sale is backdated and timestamps deliberately tied.
Immediate mixed-price voids succeed for all three sources; older and newer bill
voids return to 6,000 and 5,000 respectively. The real bill PUT route succeeds
through two successive price edits without mistaking an earlier correction's
reversal for a new dependency. Immediate mixed-price customer returns void again.

Migration `20261016093000_inventory_posting_order` gives future ledger inserts a
database sequence and links newly created lots to their exact inbound movement.
Transaction-start timestamps and business dates are not used as posting order.
Legacy order/link fields stay NULL: uncertain WA reversals refuse with legacy
review guidance, rather than guessing chronology. All 17 migrations apply to a
fresh isolated database. Existing QA's previously manually added carrying-value
columns were verified against their migration and its history reconciled before
applying this migration. No production schema or data changed.

The inbound-link FK moves a migration rollback race's wait earlier, into ledger
deletion. That regression still verifies a real inventory lock wait and exact
stock/GL preservation after the serializable rollback refusal.
Final verification: 49 targeted PostgreSQL cases pass; broad integration has
464 passes and only the known negative-stock hard failure. All 1,309 workspace
unit cases and TypeScript pass. Backup suites remain excluded for unavailable
local client tools. Unrelated local report/UI edits are not part of this change.
Negative-stock posting is still unfinished. Migration commits are also in draft
PR #173; do not stack this branch onto #171 unchanged. Resolve that dependency
and clean up WIP commit titles when preparing the review history.

## Review correction: reversed issues no longer block inbound voids (2026-10-18)

The posting-order guard treated every later outbound row as a dependency. Two
kinds leave the Weighted Average pool exactly as if they never happened, yet
blocked the void with no way forward:

- an issue fully restored by its own void (sale, supplier return or stock
  decrease): the restore returns its recorded value, so the pool is unchanged;
- the removal row of another inbound void: that inbound left at its original
  value after passing this same guard, so the remaining stock is unaffected.

Receive 5 at 1,000, 5 at 1,200 and 5 at 1,400; void the 1,400 bill, then the
1,200 bill. Previously the second void refused with an internal row ID; it now
leaves 5 units at 5,000 in the stock ledger, lots and Inventory GL. Selling four
and voiding the sale now also allows the 1,200 void, ending at 5,000.

Migration `20261018020000_inventory_ledger_reversal_link` adds
`InventoryLedgerEntry.reversesLedgerEntryId`. Inbound voids set it on their
removal row (pointing at the lot's inbound movement); sale, supplier-return and
adjustment voids set it on their restore row (pointing at the outbound row).
It is a plain indexed column, not a foreign key, so migration rollback deletes
take no extra row locks. Legacy compensating rows stay NULL and still block;
legacy sale voids are recognised through their existing `reversedAt` marker.
A later active issue still refuses, naming the first one that is not reversed.

Four PostgreSQL regressions cover the receipt chain, the voided sale, a voided
stock-count loss (which is named while active) and an active sale after a voided
one (with full rollback snapshot). All four fail on dc35891 and pass now. The
void-guard file has 16 passing cases; broad integration has 468 passes and only
the known negative-stock hard failure. TypeScript and all 1,270 unit cases pass
(the period-guard policy case times out only under full parallel load).

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
failure, hidden or counted as passing. Finance approved receipt-date COGS
adjustments on 2026-10-15: a later receipt at a different price settles estimated
cost through COGS while preserving the original sale. Implementation is pending.
Do not merge this branch until compatibility and the selected treatment pass.

The earlier stored-model broad run had 414 passing cases and exactly the negative-stock case
failing. Old correction-policy assertions have been replaced with successful
recorded-cost correction/void cases while retaining a legacy refusal regression.
The full suite must pass before review/merge readiness. Unit tests passed 1,259
cases and TypeScript passed with the new tests; the latest UI copy still needs
its final check.
No browser, full migration/recovery or production acceptance is claimed.

## Read-only diagnostic and remaining gates

Receipt tests exposed another existing value gap: direct bills and PO goods
receipts rounded the unit cost to two decimals before adding stock. Three units
with net line value 1,000 produced stock ledger/carrying value 999.99 while GL
Inventory was 1,000. Both now pass the exact booked line value into the cost layer;
original unit cost retains database six-decimal precision. Sales-return restocking
also supplies its exact recorded total. No historical postings are rewritten.

Eight new PostgreSQL tests fail before the fix and pass after it, covering FIFO
and WA, direct bill and PO receipt-then-bill, untaxed and VAT-inclusive values.
Fixed expectations prove exact Inventory/GRIR/AP/Input Tax, full stock depletion
at COGS 1,000 and sale reversal restoring 1,000 into the same receipt lot. These
tests call the actual posting services, not the PO receive route/browser, and
do not complete PO receipt/return race acceptance. Unit tests and TypeScript
pass. Latest broad PostgreSQL run: 452 pass, with the one existing HARD failure
in opt-in WA negative-stock compatibility; backup suites remain excluded due
missing local client tools. All 1,259 unit cases and TypeScript pass. The
unfinished negative-stock implementation still prevents branch merge.

Supplier-return/direct-stock-bill receipt races exposed a new warehouse leak:
an unassigned return consumed older stock from another warehouse (18,000 instead
of the unassigned 2,000). Non-sale outbound documents now treat NULL as the
unassigned pool for both sufficiency and lot selection. Unspecified sales retain
cross-warehouse fulfillment, valuing each actual source separately. This also
corrects unassigned stock-adjustment decreases; it does not move historical lots
or change the negative-stock policy.

Four real PostgreSQL supplier-return posting/void versus direct bill receipt
races pass in both orders, with fixed pool/clearing/AP values and unaffected
other-warehouse stock. Voids restore their original removal value after receipt,
not the new average. Two additional FIFO/WA cases prove unassigned adjustments
use that pool and insufficient supplier returns refuse despite other warehouse
stock, preserving complete lot/draw/ledger/document/journal snapshots. The
targeted warehouse/return suite passes 30 cases; 1,259 unit cases and TypeScript
pass. These direct-bill stock receipts do not cover PO goods-receipt journeys.

The earlier broad PostgreSQL run after the warehouse fix had 444 pass and one hard failure,
the existing opt-in WA negative-stock compatibility case. Local backup suites
remain excluded for missing PostgreSQL client tools. No new integration failure
appeared; the branch remains unready to merge until the approved policy is
implemented and compatibility passes. This is not production/migration/recovery/browser acceptance.

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

Remaining gates: approved negative-stock posting/replenishment implementation, legacy initialization
and independent GL audit, migration safeguard review/recovery, full
return/receipt/void races, period/month-end and browser acceptance, upgrade/recovery
checks and an authorized release. Nullable carrying values require explicit
initialization/diagnostics for old data; a current allocation cannot certify past
cost of sales. Issue #170 and the overall Accurate-replacement goal remain open.
