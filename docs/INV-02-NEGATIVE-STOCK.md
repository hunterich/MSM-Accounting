# Weighted Average negative stock — approved policy, implemented, database acceptance pending

Finance approved on 2026-10-15: retain the original estimated sale; recognize
the difference when actual goods arrive, in that warehouse's pool. Selling two
units at estimated 100 posts Dr COGS 200 / Cr Inventory 200. Receiving two at 120
posts Dr Inventory 240 / Cr GRIR or AP 240, then Dr COGS 40 / Cr Inventory 40.
The shortage is cleared, physical stock is zero, and Inventory is zero. A cheaper
receipt credits COGS instead. If three units arrive, one remains valued at 120.

## What is implemented (branch `claude/inv02-negative-stock-settlement`)

Additive migration `20261018090000_inventory_shortfall_settlements` adds the
`SHORTFALL_SETTLEMENT` stock movement type, an explicit `shortfall` flag on
`InventoryLotDraw` and the `InventoryShortfallSettlement` link table. Existing
rows are not backfilled.

**Sale.** A Weighted Average sale (with negative stock allowed) that exceeds the
pool records the missing quantity as a flagged shortfall draw at its estimate.
The drained lots take the pool's exact remaining book value and the shortfall the
rest, so the pool afterwards equals minus the uncovered estimate to the cent
(5 at 100, sell 7: 700 COGS, -200 Inventory). A sale from an already-short pool
is estimated at the item cost price. Only sales may run short: Weighted Average
adjustments and supplier returns beyond stock on hand are refused.

**Receipt.** Every inbound through `addCostLayer` (bills, PO receipts, customer
returns, adjustment increases, opening/batch stock) settles the oldest
outstanding estimates of the same item and warehouse with the pure
`allocateShortfallReceipt`. Covered quantity is consumed from the new lot; only
excess stays on hand at actual receipt value. Per covered draw it writes one
value-only `SHORTFALL_SETTLEMENT` movement (no quantity) and a settlement row
linking sale draw, sale movement, receipt movement and lot, that movement and
the receipt-date journal (one per receipt lot, Dr COGS / Cr Inventory or the
reverse; none for an exact match). Stock ledger and Inventory GL move by the same
amount. The sale's quantity, draw estimate and `cogsAmount` never change. Partial
receipts use cumulative rounding so each estimate and receipt close exactly.

**Coordination and periods.** All writers already hold `lockInventoryItems` before
journal numbering; settlement and its reversal run inside that lock. The
receipt/void date's accounting period is checked with `assertPeriodOpen` (the
caller has already applied the transaction-date window to that date). Missing
Inventory/COGS accounts refuse before any stock change.

**Reversals.** Receipt void (bill void, un-receive, bill re-post, customer-return
void, adjustment void) unwinds the document's settlements first: covered quantity
returns to the lot, a linked value-only movement and a reversal journal on the
void date reverse the difference, and the settlement row is marked reversed and
kept. The estimate becomes outstanding again. A receipt is refused while a later
receipt settled the rest of the same sale draw. Sale void unwinds the sale's
settlements (received stock returns at actual cost), restores only physical lots
and reverses the full estimate in the stock ledger. Lines are restored newest
first. A sale void, supplier-return void or adjustment-decrease void that would
put stock back beside another sale's uncovered estimate is refused; void that sale
first. Editing an invoice with a shortfall remains void-and-replace. Changing the
costing method is refused while any estimate is uncovered.

**Legacy pools.** A negative pool is accepted only when it equals minus its tracked
uncovered estimates with nothing on hand. Pre-policy negative stock (unflagged
draws) is refused by posting and by the read-only proposal ("requires review");
no history is fabricated. `scripts/audit-weighted-average-pools.sql` lists
tracked estimates as informational and untracked negative pools for review. No
production remediation is authorized.

## Verification status

TypeScript passes. All unit tests pass (1,301 cases in 169 files), including 31
new cases: settlement, partial receipts, cheaper/excess receipts, closed period,
missing accounts, inconsistent history, receipt/sale unwinds and ordering
(`inventory-shortfall-settlement.test.ts`), sale split and void/receipt paths
(`weighted-average-shortfall-costing.test.ts`) and negative-pool proposal rules
(`inventory-carrying-preview.test.ts`).

**Not run:** `weighted-average-negative-stock.int.test.ts` now holds the original
hard regression unchanged plus 14 new PostgreSQL cases (receipt into a negative
pool, excess/cheaper/partial receipts, warehouse isolation, closed-period
rollback, receipt-void and sale-void unwinds, dependent-sale and later-receipt
refusals, edit refusal, legacy review refusal, and overlapping sale/receipt and
receipt-void/sale-void). This machine has no PostgreSQL test database or `.env`,
so neither these, the migration, nor the audit SQL have executed. Full database
acceptance must keep the hard regression until it passes; no expected-failure
marker is used.
