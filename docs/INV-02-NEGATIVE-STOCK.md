# Weighted Average negative stock — approved policy, implementation pending

Finance approved on 2026-10-15: retain the original estimated sale; recognize
the difference when actual goods arrive, in that warehouse's pool. Selling two
units at estimated 100 posts Dr COGS 200 / Cr Inventory 200. Receiving two at 120
posts Dr Inventory 240 / Cr GRIR or AP 240, then Dr COGS 40 / Cr Inventory 40.
The shortage is cleared, physical stock is zero, and Inventory is zero. A cheaper
receipt credits COGS instead. If three units arrive, one remains valued at 120.

`allocateShortfallReceipt` is a pure allocation component, not an active posting
path. It takes the receipt's exact quantity/value and ordered outstanding sale
estimates, including previously settled quantities/values. Cumulative rounding
closes each original estimate and receipt exactly over partial deliveries.
Eleven unit cases pass, including the approved example, excess receipt stock,
cheaper receipts, zero-cost receipts, multiple estimates, fractional quantities,
successive partial rounding and inconsistent-prior-state refusal. TypeScript
passes. Inputs are not mutated. This does not make negative stock postable yet.

Next implementation must persist the links between shortage sale draws, receipt
movements/lots and adjustment journals. Those links must support partial receipts
without changing original sale quantities/costs or inferring provenance from
journal descriptions. Covered receipt quantity clears the shortage; only excess
quantity remains physically available. The stock ledger needs the same monetary
adjustment as Inventory GL, with no duplicate quantity movement.

All writers must coordinate through sorted item locks before journal numbering,
validate the receipt/adjustment date against its period, and settle only the
matching warehouse. Reversals must unwind linked adjustments atomically or refuse
dependent activity before changing stock. Include receipt-void and sale-void,
closed-period and overlapping sale/receipt/void checks. Existing legacy negative
pools without complete estimate tracking require read-only review, not fabricated
history. Full database acceptance must retain the existing hard regression until
it passes; no expected-failure marker or production remediation is authorized.
