# INV-02 carrying-value implementation

Finance approved remaining recorded book value / remaining quantity on
2026-10-14, retaining original receipt prices. Draft PR #171 fixes repeated-sale
consumption. This document tracks the remaining model; it is not a readiness or
deployment claim.

## The amounts we must keep separate

For 5 units received at 1,000 and 5 at 1,200, the booked pool is 11,000.
Selling four at the 1,100 average leaves six units and 6,600. Physical oldest-first
draws leave one unit from the first receipt and five from the second. Their
original prices stay 1,000 and 1,200. Their proposed carrying values are 1,100 and
5,500, totaling exactly 6,600. Allocating that value is not a new purchase, sale,
expense or GL entry.

`lib/inventory-carrying-allocation.ts` performs this allocation with integer
four-decimal quantity units and integer cents. Largest fractional remainders
receive remaining cents, with stable lot IDs breaking ties. Depleted lots get
zero. Negative values, invalid precision, duplicate identities and value without
quantity refuse. Original purchase costs are not inputs to this allocation.

## Read-only preview

`lib/inventory-carrying-preview.ts` compares recorded quantity with physical lot
quantity using exact Decimal arithmetic, then proposes current carrying values.
It refuses inconsistent or negative pools. It does not initialize or persist a
field, reconstruct history, change a receipt or post a balancing journal.

Provide an explicitly reviewed DATABASE_URL, then run:

```text
node node_modules/tsx/dist/cli.mjs scripts/preview-inventory-carrying.ts --company COMPANY_ID --item ITEM_ID
```

Use `--warehouse WAREHOUSE_ID` for the existing named-warehouse scope. Without it,
the current company scope includes all warehouses. The command validates company
method and ownership and opens a repeatable-read transaction with database-enforced
READ ONLY. Output is labelled READ_ONLY_PROPOSAL; do not treat it as an authorized
backfill. Allocation tests cover large decimal amounts and sub-unit quantities;
real PostgreSQL tests exercise the CLI, verify the read-only transaction and
compare stock/movement records before and after.

## Decisions and unfinished engineering

- Finance confirmed separate Weighted Average pools per warehouse on 2026-10-14.
  Implement that policy consistently in physical draws, movement-ledger warehouse
  identities and carrying allocations, including unassigned stock. The current
  prototype still illustrates the old optional scope; it must be updated before
  activation. Preserve legitimate fulfillment across warehouses rather than
  silently assigning the first warehouse's identity. Company inventory reporting
  must sum the separate pools, not recalculate a pooled sale cost.
- Add a separately named carrying-value field only with a reviewed migration and
  initialization plan. Legacy receipt prices are not carrying values. A current
  allocation cannot certify that legacy COGS was correct.
- Every receipt, sale, restock, adjustment, restoration and reversal must maintain
  carrying values under sorted item locks before journal numbering. Include
  migration commit/rollback and costing-method changes in the writer audit.
- A receipt reversal restores/removes its original recorded amount, not its newly
  allocated carrying amount. Recalculate remaining allocations and refuse any
  impossible residual. No guessed COGS adjustment to force reconciliation.
- Track exact monetary draw amounts where needed for FIFO transitions and exact
  corrections. Original receipt prices remain available for audit and original
  document reversals. Allocation does not itself authorize Weighted Average
  invoice corrections currently refused by exact-restoration checks.
- Cover zero-cost stock, final cents, negative-stock recovery, cross-warehouse
  movements, both concurrency orders, price changes, taxes and explicit rollback
  of stock, ledger, document status and GL. Replace the existing expected-failure
  only when stored lot carrying values reconcile through the full matrix.

## Confirmed costing-method switch defect

The new hard regression in
`lib/__tests__/integration/costing-switch-book-value.int.test.ts` receives real
bills for 3 × 1,000.50 and 4 × 1,200.25, then calls the actual method-switch API.
Expected Inventory ledger/GL/value is 7,802.50. Current FIFO → Weighted Average
rounds the average to 1,114.64 and replaces the receipt lots: lot value and GL become
7,802.48, while the movement ledger remains 7,802.50. The API also lacks the shared
sorted item locks. The hard regression is intentionally still failing on the
unfinished branch, not converted to an expected failure or counted as passing.

The repair must preserve value and receipt identities, coordinate method changes
with writers and decide how the new method consumes future stock at carrying
value. Ordinary organization-settings edits can also change `costingMethod`;
they must not bypass that coordinated path. Re-test existing switch tests with
real receipts/GL rather than relying only on manually seeded lots.

No production schema, records or settings were changed by this work. Issue #170
remains open; full INV-02 and inventory/month-end acceptance are unproven.
