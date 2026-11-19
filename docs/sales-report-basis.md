# Sales report basis

The sales summaries and sales history use invoice and credit-note movements,
excluding output tax. Gross sales are invoice amounts after invoice discounts,
before credit notes; returns are applied credit notes excluding their tax, and
net sales are gross less returns. Each invoice and credit note is recognised on
its own date; a known void is reflected on the dated reversal. This differs
from the dashboard's tax-inclusive settlement figures.

Items are grouped by master item ID and shown with the current SKU and name.
Invoice lines without a master item are combined into one "No item" row. Invoice-level
discounts and tax-inclusive amounts are allocated to lines by their subtotals,
rounded cumulatively so the document amount is retained. Invoice charges and
amounts without a usable item allocation appear separately as unallocated.
Linked credit notes are allocated by the return-line amounts. Standalone notes
and notes without a reliable set of source lines remain unallocated, rather
than being attributed to an arbitrary item. Returned quantities follow the
posted return date, independently of the credit note date and regardless of
whether the goods were received back into inventory. Multiple partial notes
therefore do not duplicate the returned quantity.

The report is a document-based sales subledger, not a replacement for the P&L.
Reconcile its net amount to the corresponding sales revenue and returns accounts;
other income, invoice charges posted to non-revenue accounts, manual journals,
migration openings and other adjustments can cause differences that require
review. Filtering to a customer, item or top N also changes the population.
Unknown or ambiguous historical void dates, voided physical returns, missing
return source lines and applied notes without a posting journal produce report
warnings. Voided returns without a reliable dated reversal cannot be reconstructed
as historical quantities; review the original documents before relying on them.

Sales returns currently post to an Expense-type account (`arReturn`, by default
`5-2000 Sales Returns`), so the P&L shows revenue before returns and the returns
under expenses. Net sales in these reports therefore equal P&L sales revenue
less the sales returns account, not the P&L revenue line alone. Reclassifying
returns as contra-revenue is tracked in #220 and is not required for this
reconciliation.
