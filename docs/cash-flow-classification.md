# Cash flow account classifications

The indirect cash-flow statement reads posted general-ledger journals. In the chart of accounts, set **Klasifikasi arus kas** for each account with a balance or activity. The setting is independent of the free-text report group and applies to historical periods too. Accounts that have not been reviewed are listed on the statement and CSV; existing organizations are not automatically reclassified by the migration.

- **Kas dan bank**: cash and bank asset accounts. This overrides inferred bank/default matches. Select **Operasional / lainnya** for clearing accounts that are not cash, even if their name contains “bank”.
- **Aset tetap — nilai perolehan**: gross fixed-asset cost; its net change is shown as investing activity.
- **Akumulasi penyusutan / amortisasi**: accumulated depreciation or amortization, separate from gross cost. The report excludes this account's movements and adds back expenses classified below. Review all movements, especially disposals and adjustments.
- **Beban penyusutan / amortisasi**: non-cash depreciation or amortization expense to add back to profit.
- **Liabilitas jangka panjang**: financing activity.
- **Operasional / lainnya**: ordinary assets, liabilities, revenue, expenses and equity; equity is presented as financing.

Until reviewed, the existing names, groups, bank-account matches and configured default provide a compatibility estimate. They can be incomplete or wrong. In particular, a clearing account may be mistaken for cash; compare the list of unreviewed accounts and set an explicit classification. A reviewed classification overrides these guesses. Inactive accounts are included because their historical balances remain relevant. A reviewed cash header can identify unclassified children, but each child is still flagged for review.

The statement compares ending cash to the balance-sheet rows for the same selected cash accounts, using a separate as-of-date ledger query. A difference is displayed in the report and CSV. This detects discrepancies between those calculations; it cannot detect an account omitted by both. Finance should independently review which accounts are cash and compare them with the balance sheet. If no cash accounts are found the report warns instead of silently implying zero is confirmed.

The indirect statement uses account-level net changes, not transaction-by-transaction cash-flow classification. Net changes can mix cash and non-cash activity, transfers, disposals, borrowing to buy assets, and reclassifications. A zero reconciliation difference does not establish that the operating, investing and financing sections are correct. Review and adjust such transactions outside this report. The accumulated-depreciation warning remains even when the totals reconcile. These classifications do not change journal entries, the balance sheet, payment account selection, or the Banking register.
