# Marketplace shipment and refund workflow

Issue #242 policy, agreed 17 November 2026: recognise revenue and COGS and reduce stock on the actual shipment date. Record the invoice receipt into the marketplace clearing/holding asset. Reconcile fees and bank withdrawals separately; the receipt is not evidence of a bank payout.

## Orders

- Import the full order export regularly, including orders still in transit. A completion-only or matched-payout export cannot reveal shipments absent from that file.
- The import wizard selects shipped/completed orders and holds cancellations/returns for review. It reads the actual dispatch date. An order without that date is blocked until staff enter its actual dispatch date; split different dispatch dates into separate batches. Order creation, payment, ready-to-ship and completion dates are not substitutes.
- A repeated completed-order export does not post another sale or stock issue. Existing invoices retain their original financial dates. Historical completion-dated invoices need finance review; this change does not silently redate them.
- An unshipped cancellation creates no sale. If a shipped order is cancelled before completion, use the original imported invoice to create its return. If its shipment was never imported, first record the original dispatch using verified shipment data, then record the return; do not import the cancelled row as a new positive sale.
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

Apply the additive `20261117120000_marketplace_refund_reconciliation` migration before starting this version. It adds a receipt link and reconciliation time to credit notes, plus the shipment filter default for new connections. Existing financial postings and shop settings are retained. The order wizard uses shipment selection for both existing and new shops.

Validate month-end shipment/completion, an unshipped cancellation, cancellation after dispatch, returns with and without received goods, refund-before-payout and refund-after-payout, replay, wrong-company/order/wallet notes, and concurrent reconciliation. Keep deployment and finance acceptance separate from code validation.
