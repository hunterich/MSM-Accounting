# Weighted Average negative stock — approved policy and acceptance

Finance approved on 2026-10-15: retain the original estimated sale; recognize
the difference when actual goods arrive, in that warehouse's pool. Selling two
units at estimated 100 posts Dr COGS 200 / Cr Inventory 200. Receiving two at 120
posts Dr Inventory 240 / Cr GRIR or AP 240, then Dr COGS 40 / Cr Inventory 40.
The shortage is cleared, physical stock is zero, and Inventory is zero. A cheaper
receipt credits COGS instead. If three units arrive, one remains valued at 120.

## Implemented behavior (merged in #177)

Additive migration `20261018130000_inventory_shortfall_settlements` adds the
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

The final #177 head passed all three CI jobs, including 487 PostgreSQL cases,
unit/type checks, builds and browsers. Its original "not run" implementation
notes are superseded by that acceptance evidence.

The 2026-10-19 follow-up reproduces and fixes two receipt defects:

- A multi-line receipt unwound all settlements, then refreshed carrying values
  after removing only one lot. The temporary pool state wrongly refused the
  whole reversal. Refresh now runs once per affected warehouse pool after all
  receipt lots are removed, inside the existing item locks. Original-value and
  later-issue guards still run before removal.
- A PO receipt with total zero returned before creating lots. It now records
  physical receipt quantity and settles shortages at actual zero cost, including
  the linked COGS credit. No zero-value receipt journal is invented.

`weighted-average-negative-stock.int.test.ts` has 22 passing PostgreSQL cases,
including four duplicate-item bill/PO reversal variants and both forced
sale/receipt void orders. `zero-value-goods-receipt.int.test.ts` adds three
passing receive-route/un-receive cases for FIFO/WA and a tracked shortage.
The original negative-stock regression still runs as an ordinary passing test.
See `TESTING.md` for the broader targeted and browser commands.

All 20 migrations apply successfully to fresh isolated PostgreSQL 16 QA
databases. This follow-up needs no schema change. Legacy negative pools still
refuse review; no legacy tracking is fabricated and no historical balancing
entry or production initialization has been performed. Production diagnostics,
reviewed remediation, migration/recovery rehearsal, remaining inventory race
and month-end coverage, finance acceptance and authorized release verification
remain open under #170.
