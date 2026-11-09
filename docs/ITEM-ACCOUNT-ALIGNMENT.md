# Item account alignment (#219)

The item master stores separate inventory, sales revenue, and COGS accounts.
Opening stock uses the item's inventory mapping, but the main invoice, goods
receipt, direct bill, purchase return, sales return, stock adjustment, POS
stock-in, and negative-stock settlement posting paths currently resolve company
defaults for at least one of these roles. A mixed configuration can therefore
post an opening or receipt to one account and relieve stock from another.

The item form warning describes the current behavior; it is not a posting fix.
`audit-item-account-mappings.ts --company ID` reports current differences and
invalid mappings. Supply `DATABASE_URL` explicitly. The command uses a
company-scoped repeatable-read, database-enforced read-only transaction.
Movement counts and values provide context, not a reconciliation against the GL
or a historical account attribution. Audit results require review: do not
automatically rewrite documents, journal entries, balances, or item mappings.

The durable fix needs consistent per-item posting across all paths, including
mixed-account documents and tax/discount allocation, plus original-account
provenance for sales returns, receipt reversals, invoice edits and voids, and
negative-stock settlement. Existing movements may not retain enough per-line GL
provenance; ambiguous historical cases must be identified and reviewed rather
than inferred from a current item setting. Mapping changes while stock exists
are refused. The guard checks quantity and value per warehouse, including
physical lots, and uses the item stock lock to serialize concurrent postings.
The existing approval system does not currently include this item-account
change: a manual journal or an approval for another document is not treated as
evidence to bypass the guard. A zero balance does not establish the original
account for a future return or reversal; that provenance remains unresolved.

This increment adds an audit and warning, validates account roles on item create
and update, rejects invalid stored inventory mappings when posting opening
stock, and blocks inventory-account changes while stock or inventory value
remains. It does not switch the remaining posting accounts, establish a migration
policy, run against company data, or complete issue #219.

## Approved inventory-account transfer

The owner requested the existing approval system for inventory-account
transfers. The approval should identify one company, item, source account,
destination account, effective date, reviewed quantity and value, requester,
approval decision and resulting journal. The approval inbox must show these
details rather than only a generic document number. A finalizer must lock the
item, recheck the pending request and stock/account snapshot, check the period
and permissions, then post the balanced transfer and update the item mapping in
one transaction. A changed stock balance, mapping, account status, period or
other stale condition must refuse finalization without a partial journal or
mapping change. Rejection must leave both unchanged. Duplicate, concurrent and
retried requests must not transfer twice.

The approval engine can provide authorization, request state, approval audit,
and atomic finalization, but it does not currently have this document type or
the item/account linkage. Approval alone is not evidence of the GL account
that actually holds an individual item's stock: the existing receipt, bill,
sales and return journals often aggregate lines and use company defaults.
Changing the configured item account after an approval while those paths remain
unchanged would still misdirect future postings. A PostgreSQL baseline test
demonstrates the current behavior: opening two units at 100 on a distinct item
account and selling one leaves 200 on that account and credits 100 to the
company default, while the item ledger carries 100.

Before enabling the transfer, the posting paths need per-item original account
provenance and coherent handling across receipts, sales, returns, adjustments,
POS and reversals. Legacy amounts whose account attribution cannot be proven
must be reviewed rather than silently inferred from the current item setting.
The proposed flow remains unimplemented and is not a substitute for that work.
