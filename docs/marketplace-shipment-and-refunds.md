# Marketplace shipment and refund workflow

Issue #242 policy, agreed 17 November 2026: recognise revenue and COGS and reduce stock on the actual shipment date. Record the invoice receipt into the marketplace clearing/holding asset. Reconcile fees and bank withdrawals separately; the receipt is not evidence of a bank payout.

## Orders

- Import the full order export regularly, including orders still in transit. A completion-only or matched-payout export cannot reveal shipments absent from that file.
- The import wizard selects shipped/completed orders, skips cancelled rows and holds return statuses for review. It reads the dispatch date. For a shipped or completed Shopee order without one, it uses `Waktu Pengiriman Diatur` (shipping arranged) as the accounting-date proxy, as directed by the owner; this is not independently verified as the courier handover date. An order without either date is blocked until staff enter a verified date; split different dates into separate batches. Order creation, payment, ready-to-ship and completion dates are not substitutes.
- A repeated completed-order export does not post another sale or stock issue. Existing invoices retain their original financial dates. Historical completion-dated invoices need finance review; this change does not silently redate them.
- For TikTok, the imported sale uses the SKU subtotal after discount plus the platform-funded SKU discount, giving the seller-side subtotal before PPN treatment. Use the original order export: a prepared file may have already reduced quantities or amounts for a return. Record the original sale and its linked refund credit note separately, and have finance verify PPN and platform-discount treatment.
- Preview and import use the seller-side line amounts in the order export. Each line rounds half up to two decimal places before the invoice totals are summed and PPN is applied. Where the export leaves the line amount blank, it is calculated from the quantity and unit price.
- A cancelled row is skipped and creates no sale. If an already imported shipment is later cancelled, handle its return and credit note separately against the original invoice. If its shipment was never imported, review the dispatch evidence and record the original shipment and return separately; do not import the cancelled row as a new positive sale.
- API compatibility: callers without `shipmentDate` must supply the actual dispatch date in `issueDate`. When `shipmentDate` is supplied it overrides `issueDate` for the invoice, stock, revenue, COGS and clearing receipt.

## Returns, including cancellation after dispatch

1. Create a sales return linked to the original invoice and exact invoice lines. Record the actual return date and quantity. Mark goods received only for goods actually received; choose the defect warehouse for damaged returns. A refund without receipt of goods does not restore stock or reverse COGS.
2. Complete the existing return approval process. Create and apply a linked credit note with settlement type **Refund**, using the **original marketplace clearing GL asset account**. The credit note reverses sales/tax and credits the wallet. Follow the normal approval process; settlement import does not create or approve returns or credit notes.
3. In settlement import, enter the applied credit note number(s) against the statement's refund amount. Notes must belong to the same company, invoice and original wallet, link to a posted sales return, and total exactly the refund amount. No refund is sent to a fee or adjustment account when this evidence is missing: the row fails for review.
4. For the original payout, settlement posts fees against **gross invoice minus net released minus the already-booked refund**. It links the credit notes to the original receipt and stamps reconciliation time. It never posts the refund a second time.
5. For a refund after settlement, use **Reconcile a later refund by order**, entering the order number, positive statement refund amount and applied credit note number(s). Alternatively upload refund debit rows and select later-refund mode. Such rows must contain only the refund with net released equal to minus the refund. Other fees/adjustments need separate review. This step links existing postings and writes no new journal.

Reimporting the same refund notes is a no-op. Previously reconciled notes cannot be mixed with new notes or reused for another receipt. Reconciled refund notes cannot be voided in isolation: corrections require finance review and correcting documents that preserve the statement reconciliation.

Legacy settlements that already posted a refund to the old refund account require finance review before creating another refund credit note; do not treat reconciliation as a historical repair. Sales-report return presentation remains tracked separately in #240.

## Release checks

Settlement statements may cover multiple release dates. The Shopee income
report's order-level `Payout Completed Date` is used for each order when its
`View By` column is present; SKU detail rows are excluded to avoid counting
orders twice. For statements without per-order dates, enter the actual
settlement date and split a file with multiple release dates before importing.
The API accepts a separate `settlementDate` (YYYY-MM-DD) per order. The journal uses
that calendar date at UTC midnight, consistent with date-only ledger fields;
the closed-period and transaction-date guards apply to that date. `settledAt`
is the import timestamp, not the financial date. Later-refund reconciliation
links an existing journal and does not post a new journal. Confirm the source
statement and its dates before use; TikTok dates still require manual entry.

Shopee and TikTok settlements compare the released amount to the saved invoice,
original wallet receipt, mapped fees and linked refunds. If multiple report
columns contribute to one fee, their amounts are added before that fee is
rounded half up to two decimal places. The rounded fees are the amounts that
post to the GL. An unexplained difference, including Rp0.01, leaves the payout
open for review. The older API adjustment behavior requires an explicit
`requireMappedCharges: false` and an adjustment account for any residual.

Shopee's split `Income - 1`, `Income - 2`, etc. sheets are read together.
Configure each fee, shipping, subsidy and withholding account used by the
file; Free Shipping XTRA and Other Fee have separate account selectors. The
withholding selector permits an asset account, but finance must decide the
correct tax treatment. A missing account, unrecognised nonzero financial
column, unexpected sign, duplicate order, or unexplained imbalance stops the
affected import for review instead of silently posting to an adjustment account.
The report's separate adjustment transactions are listed for manual review and
are not posted automatically. Match payout amounts and dates to the Shopee
balance report; zero-release orders may have no balance transaction. A refunded
order still requires its linked applied credit note. A refund with later fees
or adjustments may require separate review; do not infer stock receipt.

`scripts/audit-marketplace-release-candidates.sql` prepares read-only candidate
lists for finance. The first lists imported invoices for comparison with actual
dispatch evidence; it cannot identify completion dates by itself and excludes
unverified legacy receipts. The second identifies explicitly labelled legacy
refund journal lines and applied credit notes on the same invoice; adjustment
lines, manually created transactions and missing provenance require separate
review. Neither query establishes an error or changes transactions.

### Finance acceptance example (illustrative, not approval)

Assume shipment on 31 January: goods Rp100,000 before PPN of Rp11,000,
cost Rp60,000. Post debit receivable Rp111,000; credit sales Rp100,000 and
output PPN Rp11,000; debit HPP Rp60,000 and credit inventory Rp60,000. The
marketplace receipt debits clearing and credits receivable Rp111,000. A
February settlement with Rp10,000 fees debits fee expense and credits clearing
Rp10,000; Rp101,000 remains in clearing. A withdrawal debits bank and credits
clearing Rp101,000, and must match the bank statement. A later full refund
credit note reverses sales Rp100,000 and PPN Rp11,000 and credits clearing
Rp111,000; only physical receipt of the goods restores inventory and reverses
HPP at the applicable original cost. The example assumes a full refund and
that fees are not reversed. Actual tax rate, tax treatment, return valuation,
and settlement terms must be checked against the source documents.

Finance should confirm shipment evidence and periods; PPN and HPP treatment;
fee and refund statements and clearing balances; physical receipt and valuation;
bank withdrawal reconciliation; and treatment of historical exceptions before
accepting a pilot. No finance approval is implied by this example.

For a withdrawal, record a transfer from the marketplace wallet to the bank.
Match the positive bank statement line to the destination leg; if the wallet
also supplies a statement, match its negative line independently. A transfer's
overall status is `MATCHED` when at least one statement leg is matched; inspect
each statement for its own status. Unmatching one leg preserves the other, and
matched transfers cannot be edited until their statement lines are unmatched.
Ambiguous or legacy matches need review. A posted transfer alone does not prove
that either statement has been reconciled.

Apply the additive `20261117120000_marketplace_refund_reconciliation` migration before starting this version. It adds a receipt link and reconciliation time to credit notes, plus the shipment filter default for new connections. Existing financial postings and shop settings are retained. The order wizard uses shipment selection for both existing and new shops.

Validate month-end shipment/completion, an unshipped cancellation, cancellation after dispatch, returns with and without received goods, refund-before-payout and refund-after-payout, replay, wrong-company/order/wallet notes, and concurrent reconciliation. Keep deployment and finance acceptance separate from code validation.
