# Item account alignment (#219)

Each item can name its own inventory, sales revenue, and COGS account. A blank
field uses the company default. A field that names an invalid account (wrong
company, wrong type, inactive, or not postable) is refused rather than silently
falling back.

## Posting

Sales invoices, goods receipts, direct bills, purchase returns, sales returns,
stock adjustments, POS stock-in, opening stock, and negative-stock settlement
resolve accounts per item. Items with blank accounts post the same journals as
before this change. Mixed-account documents post one balanced line per account,
with invoice revenue allocated across lines by line subtotal.

Goods in transit is out of scope.

## Recorded accounts

Each posting records the GL account it used, on `InventoryLedgerEntry`,
`SalesInvoiceLine`, and `InventoryShortfallSettlement`. `Bill` keeps its receipt
journal in `receiptPostingJournalId`. Returns, voids, edits, receipt reversals,
and shortage settlements follow that record, never the item's current setting.

Stock booked with no value (free goods, zero-cost opening stock) never reaches
an inventory GL account, so it has no recorded account and does not block other
stock of the same item. Migrated opening stock has no journal of its own but is
recorded on the company default, where the migration's opening journal books it.

## Historical data

Rows posted before this change keep a null account. They are not backfilled or
inferred from current settings. Posting against value-bearing stock with no
recorded account is refused with a request for review, without partial journals
or stock movements. Stock from before this change therefore cannot be sold,
returned, or written down until it has been reviewed.

## Account changes

An item's inventory account cannot change while it holds stock or inventory
value, including physical lots. The check uses the item stock lock.

The company default inventory account cannot change while items with a blank
inventory account hold stock or value, because that stock sits on the current
default. Set the default before entering stock. COGS and revenue defaults can
change at any time because no stock is held on them.

Known limit: when no default is saved, the system detects one from the chart of
accounts. Adding, renaming, or deactivating accounts can shift that detected
default. Later sales then fail safely with an account mismatch instead of
posting to the wrong account. Saving the default explicitly avoids this.

## Audit

`audit-item-account-mappings.ts --company ID` reports differences from company
defaults and invalid mappings. Supply `DATABASE_URL` explicitly. It uses a
company-scoped, repeatable-read, read-only transaction. Results compare
configuration only and are not a reconciliation to the GL. Do not automatically
rewrite documents, journal entries, balances, or item mappings from them.

## Not implemented: approved inventory-account transfer

The owner requested the existing approval system for moving an item's stock to
another inventory account. It remains unimplemented, and a manual journal or an
approval for another document does not bypass the guards above.

The request should identify the company, item, source account, destination
account, effective date, reviewed quantity and value, requester, decision, and
resulting journal, and the approval inbox must show those details. Finalizing
must lock the item, recheck the request and the stock and account snapshot,
check the period and permissions, then post the balanced transfer and update the
mapping in one transaction. Stale conditions must refuse without a partial
journal or mapping change, rejection must change nothing, and duplicate or
retried requests must not transfer twice.
