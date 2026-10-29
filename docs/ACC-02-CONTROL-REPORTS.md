# ACC-02 control reconciliation reports — 2026-10-29

Refs #167. This increment exposes the existing #191 reconciliation API through the Reports catalog. It changes no posting calculations, account selection, closing policy or historical balances, and adds no migration.

## Finance workflow

Open Reports → Receivables → **AR Control Reconciliation**, or Reports → Payables → **AP Control Reconciliation**. Select an as-of date and run. Reports open in the existing workspace tabs; change filters or refresh normally.

The table shows each actual control account, the current default marker, posted GL balance, independently rebuilt subledger balance, GL-minus-subledger difference and review status. AR uses debit minus credit; AP uses credit minus debit. Each account also shows documents, settlements, notes, opening subledger/GL and the backend's named document/opening/unlinked-journal/unexplained items, including references, dates, journal numbers, sources and messages.

Company totals do not decide review status. Opposing account differences remain visible even if the total difference is zero. Named issues require review even when their own account nets to zero. An empty account scope requests setup review instead of claiming reconciliation. Matching results mean no differences were identified within the selected scope; finance must still confirm that scope and historical evidence.

CSV and PDF exports include every returned account, component and named difference, the cutoff and the company summary warning. Text is CSV-escaped and spreadsheet-formula text is neutralized; monetary cells stay numeric. Print uses the existing report view. Failed/loading refreshes cannot print/export the previous control report as current output. Refresh recovers after a transient error without changing filters.

The read-only report retains REPORTS/view and company-scoped server authorization. It does not create balancing journals, change whether a period may close, resolve finance-policy #164/#166, initialize old inventory values, or repair historical data.

## Independent fixed example — both AR and AP

New disposable QA companies use actual document, payment and standalone-note APIs. A direct database fixture deliberately recreates an old manual control-to-control journal; current public manual-journal guards remain intact.

| At 30 September 2026 | GL | Subledger | Difference |
|---|---:|---:|---:|
| Primary: 1,000 document less 300 settlement; old reclass +75 | 775 | 700 | +75 |
| Alternate: 600 document less 100 advance and 50 standalone note; reclass −75 | 375 | 450 | −75 |
| Company total | 1,150 | 1,150 | 0 |

Both rows say Review required and name the historical journal. A further 300 document dated 5 October is excluded in September; selecting 5 October gives company GL/subledger 1,450, still with both per-account differences. The two browser cases verify exact API values, rendered cells, warning messages, component values, both downloads, saved filters, failed-refresh/export protection and recovery. Complete posted journals/lines and invoice/bill snapshots are identical before and after report use.

## PDF export defect found during acceptance

The existing ESM report exporter loaded jspdf-autotable for side effects but called doc.autoTable without registering the plugin. The new actual download regression fails on the previous utility with `doc.autoTable is not a function`. Explicit `applyPlugin(jsPDF)` follows the installed package README and restores the shared exporter. No dependency change is needed. Both AR/AP PDF downloads now succeed and their rendered pages were visually inspected with Poppler; tables, negative amounts and warnings are readable without clipping.

## CI runner compatibility

The first CI run exposed a runner-image change, not a report balance failure: ubuntu-latest selected Ubuntu 26.04, unsupported by the installed Playwright, and the backup restore used a newer PostgreSQL client that emits transaction_timeout against a PostgreSQL 16 server. CI now pins Ubuntu 24.04 and explicitly selects the installed PostgreSQL 16 dump/restore tools via the test-only PG_TEST_TOOLS_PATH override. Restore assertions and all browser/database checks remain enabled.

## Reproduce and acceptance

Use only a disposable PostgreSQL 16 base database with DATABASE_URL. Run scripts/test-db-setup.mjs and scripts/e2e-db-setup.mjs to create the protected `_test` / `_e2e` siblings. Never run automated fixtures against a business database.

```text
node node_modules/vitest/vitest.mjs run --configLoader runner lib/__tests__/control-reconciliation-report.test.tsx src/utils/__tests__/exportCsvToPdf.test.ts src/components/workspace/__tests__/reportTabs.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader runner lib/__tests__/integration/control-reconciliation.int.test.ts lib/__tests__/integration/report-reconciliation.int.test.ts
node node_modules/@playwright/test/cli.js test e2e/control-reconciliation-report.spec.ts e2e/workspace-reports.spec.ts --project chromium
```

- Seven new unit cases cover kind selection, account/issue-based status, empty scope, exact component/difference exports, PDF table conversion and CSV quoting/formula handling.
- Eleven existing PostgreSQL reconciliation/cutoff cases pass unchanged.
- Five Chromium cases pass without retries: both new accounting journeys and all three report workspace cases.
- Both TypeScript projects pass. Full unit/build and CI evidence is recorded in the PR; the local Windows unit suite retains its two existing pagination-locale assertions, which pass on Linux CI.

Issue #167 remains open. Backend engineering evidence in #191/#196/#197 and settlement browser evidence in #201 are merged. This report increment still requires review; migration-screen acceptance, finance account-scope/sample acceptance and authorized staging/deployment/pilot/release verification remain separate. No production query, data rewrite, deployment or PR merge was performed.
