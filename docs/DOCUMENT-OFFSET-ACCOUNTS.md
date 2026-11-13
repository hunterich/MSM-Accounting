# Document offset account restrictions — #169

## Result

Bill lines/additional costs, invoice additional costs and stock-adjustment line selections now reject designated AR/AP control accounts. They must reference active, postable accounts belonging to the selected company. Legitimate non-control expense, prepaid/fixed-asset, cash/holding and other previously supported account types remain available. Ordinary bill AP and invoice AR postings remain supported; the restriction applies to offsets that would otherwise bypass the corresponding party subledger.

Control designation reuses `assertNoDirectControlPosting`: configured IDs, resolved defaults, standard fallback controls and additional controls designated by the company's payments, bills, returns and notes. Foreign-company designations do not designate this company's accounts. Draft and historical designations are retained by the existing policy.

The shared account-picker contract (`withControlFlags=1`, `isPartyControlAccount`, `listPartyControlAccountIds`) is compatible with open refund PR [#172](https://github.com/hunterich/MSM-Accounting/pull/172), inspected at head `7ade15f`. This increment does not import or duplicate its refund changes. Integrate the identical metadata helper/fields once when combining the branches. Refund validation and independent per-control reconciliation (#167) remain separate work; this increment does not close all of #169.

## Enforcement and recovery

- Create and edit validate selected offsets inside their existing transactions. Bill creation also validates inherited PO charges and prepared asset-line accounts.
- Automatic and explicit approval submission revalidate saved document fields. Posting helpers independently validate the accounts, including legacy pending documents; approval refusal rolls its claim/status and side effects back.
- Bill posting validates actual resolved journal offsets before adding the ordinary AP credit. Stock adjustments also validate actual inventory/variance defaults. Existing transaction boundaries preserve document, journal, stock and lot snapshots on refusal.
- Reversal helpers continue to reverse original recorded journals. They do not apply forward offset restrictions to historical bad postings.
- Pickers omit blocked accounts from new choices. A saved invalid account remains selected as a disabled option with English/Bahasa repair guidance; the UI never silently substitutes another account.
- Invoice editing loads the full invoice detail because paginated list responses omit charges. Existing additional charges can have their accounts repaired without changing their amounts. Charges participate in displayed/saved totals and inclusive/exclusive tax. Older browser drafts hydrate missing charge data while retaining unsaved notes/fields. The source document hydrates once, so background detail refreshes do not overwrite current editing input.
- Saved stock-adjustment lines are read from the API's `lines` field; both database and displayed document IDs can locate the saved draft. This makes invalid legacy choices visible and repairable.

An additional defect surfaced during acceptance: the bill approval finalizer loaded lines but omitted charges. It now loads both. A real-database acceptance case proves a 100 service + 25 charge produces AP 125 and expense 125 on approval, matching the bill total.

### Stock-adjustment scope

The existing posting engine records line account choices but posts the net adjustment through the configured variance account. This change rejects bad line selections and bad actual defaults; it deliberately preserves that existing allocation behavior. Implementing per-line variance-account allocation would be a separately scoped accounting change. No inventory costing, tax policy, opening/migration policy or historical balance rewriting is introduced here.

## Read-only audit

`scripts/audit-document-offset-accounts.ts --company ID` requires an explicitly supplied `DATABASE_URL`. It runs with database-enforced READ ONLY and Repeatable Read, and a 30-second statement/transaction timeout. It reports stored invalid selections plus recorded control-account journal lines for review, using bill journal links, invoice posting IDs and the exact legacy stock-adjustment memo convention.

This report identifies review candidates; it does not quantify or certify reconciliation differences. A stock-adjustment selection may not be the actual posting offset. Legacy invoices without recorded journal IDs require separate historical investigation. Independent per-account reconciliation remains #167. No production audit or repair has been performed.

## Verification — 18 October 2026

- Sixteen direct refusal regressions fail against the original HEAD posting helpers and pass with the new guards. Original code was copied into temporary QA-only modules for the comparison and removed afterward; no production source was reset. Temporary baseline fixtures can emit best-effort cleanup foreign-key warnings, but the regressions fail because posting resolves instead of refusing.
- All 57 new PostgreSQL cases pass: default/configured/alternate controls; foreign/inactive/header accounts; API create/edit and inherited PO charges; approval submission and actual finalizers (including charge-only drafts); complete refusal snapshots; valid source/GL amounts and voids; posted-edit rollback; legacy reversal; metadata tenant isolation; actual default variance checks; and read-only audit CLI/database enforcement.
- Final broader integration run: **531 passed, one hard failure** in the pre-existing Weighted Average negative-stock regression (`weighted-average-negative-stock.int.test.ts`, tracked separately by #170/#177). The failure is not skipped or marked expected. Host backup suites were excluded because local PostgreSQL client tools are unavailable. No full-green integration claim.
- All 1,345 unit tests pass. Existing posting-arithmetic unit fixtures mock offset authorization explicitly; the new refusal and rollback tests use real PostgreSQL and do not mock the guards.
- Eight focused Chromium cases pass: five offset/editor/charge-tax/recovery cases plus the three #74 cutoff/import-preservation regressions. These browser cases use mocked API fixtures; the PostgreSQL tests independently exercise posting, real route handlers and approval code.
- Application and E2E TypeScript checks and production frontend/backend builds pass. Logs and isolated browser configuration are under `artifacts/issue-169/`.

Only disposable synthetic QA data was used. All 18 existing migrations were applied to a fresh PostgreSQL 16 database; this increment adds no migration. The disposable #169 container and its volume were removed after verification. Existing #74 and unrelated report/inventory edits remain in the shared working tree. No deployment, merge, production audit or historical rewrite was performed. CI and release verification remain outstanding.
