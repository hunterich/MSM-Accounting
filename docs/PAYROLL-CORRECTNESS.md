# Payroll correctness and dated eligibility

Engineering implementation for review, 27 October 2026. Finance/pilot acceptance and deployment remain open. This branch is stacked on PR #201 for its dependency/Zod compatibility fixes; review the payroll diff against that branch until #201 is merged.

## Required setup

1. Apply both additive payroll migrations and regenerate Prisma during the normal reviewed release process. Existing posted amounts stay unchanged. Existing `paidDays` remain unknown (null), rather than being invented as zero. Existing runs become REGULAR; one REGULAR per company/month remains enforced by a partial unique index. Off-cycle runs have independent request keys.
2. Configure active, postable 5100 EXPENSE (salary expense), 2300 LIABILITY (PPh 21 payable) and 2310 LIABILITY (BPJS payable). Check their accounting purpose as well as their codes before use. Set the default Bank / Cash Asset in Company Setup when more than one cash account exists. Setup refusal never chooses Inventory, AP or an arbitrary asset/expense/liability.
3. Save an effective-dated policy under Payroll settings: employee/employer BPJS rates, health wage floor/ceiling, JP ceiling, JKK risk tier, work-calendar holidays and the shortest workday for six-day schedules. Policies cover whole months, cannot overlap and cannot cross the next March JP update. Settings are explicitly confirmed company inputs, not an automatic statutory-rate feed. A saved policy is immutable; enter future non-overlapping policies. Correcting an erroneous saved policy needs a reviewed administrative correction workflow.
4. Each employee needs joining date, PTKP status and tax year, five/six-day schedule and fixed/variable allowance classification. Map other employee deductions to active company receivables/liabilities. Cash and all AR/AP controls are refused. BPJS and tax are calculated separately; do not duplicate them as manual deductions.
5. Use **End employment / employee leaving the company**, last working day (inclusive) and reason. Contract expiry is a separate review date: it does not silently terminate employment. Inactive legacy employees need a real last working day. Joining/final dates already used by posted payroll cannot be casually rewritten; use a separate record for a rehire.
6. Record all scheduled attendance. Approved annual leave and doctor-certified sick days are paid; HALF_DAY counts 0.5. Approved unpaid leave counts as unpaid. Missing, uncertified or conflicting records require review and block posting. Doctor certification is an authorized HR attestation checkbox; document upload is outside this change.

## Calculation and posting

- Salary/fixed allowances are prorated using scheduled workdays in the selected month and inclusive employment dates. The supported calendar is Monday–Friday or Monday–Saturday minus configured holidays. Variable allowances are separately identified. BPJS wage basis is basic plus fixed allowances, using the period's confirmed rates/floors/ceilings.
- Monthly taxable gross includes cash earnings and employer JKK, JKM and BPJS Kesehatan. Employee JHT/JP are not subtracted from monthly TER. PTKP maps TK/0, TK/1, K/0 to A; TK/2, TK/3, K/1, K/2 to B; K/3 to C.
- December or the final employment month uses actual recorded year-to-date income, PTKP, 5% job expense (maximum Rp500,000 per employment month and Rp6,000,000/year), employee JHT/JP and Article 17 brackets. It subtracts previously posted withholding, allowing a refund. Missing prior salary months refuse reconciliation rather than assuming zero. PTKP must be consistent with earlier snapshots that year.
- Daily overtime uses 1/173 of basic plus fixed allowances, with the statutory 75% wage floor where applicable. Workdays use 1.5x then 2x; five/six-day rest/holiday bands and six-day shortest-holiday bands are applied per date. Workday hour limits are checked. Monthly overtime totals are display summaries, not calculation inputs.
- REGULAR includes salary once. THR uses explicit positive employee earnings. FINAL includes any remaining salary and reconciles tax. CORRECTION uses explicit signed earnings and a reason. These are ordinary salary/THR taxable adjustments, not an automatic severance-entitlement calculator. Combined monthly TER prevents each off-cycle run from starting a fresh tax bracket; BPJS is charged once for salary that month.
- Negative net pay needs an explicit employee recovery receivable. A zero-earning adjustment can supply that mapping for a fully unpaid salary month. Posting debits the receivable and does not invent a bank receipt. Positive employee net payments alone reduce cash.
- Other deductions credit their frozen account mappings. Employer BPJS increases expense; tax and BPJS use distinct payables. AR/AP controls are never document offsets. An account disabled after calculation also blocks approval.
- Company-scoped transaction locks serialize calculation, posting and approval. Snapshots store policy, employee dates/PTKP, daily overtime, adjustments, deduction accounts and prior posted run IDs. If another payroll posts, stale runs require recalculation. Pending approval and posted runs cannot be edited/recalculated/deleted; submission and approval repeat posting guards. Refused posting rolls back its financial/approval effects completely.

## Verified fixed examples

| Scenario | Expected result |
|---|---|
| Rp10m salary, confirmed standard test rates, TK/0 | Tax gross Rp10,454,000; TER Rp261,350; net Rp9,338,650 |
| Rp10m salary + Rp1m fixed allowance, Rp100k advance deduction | Cash decreases Rp10,057,521; advance receivable clears Rp100k; tax Rp402,479; BPJS payable Rp1,566,400; Inventory/AR/AP unchanged |
| Same Rp10m regular salary plus Rp5m THR | Combined monthly tax Rp1,081,780; THR tax Rp820,430; no second salary/BPJS charge |
| Twelve Rp10m months | December withholding Rp402,350; full-year tax Rp3,277,200 |
| Rp10m employee leaves October 15 after nine recorded salary months | 11/22 paid days; final gross Rp5m; tax refund Rp474k; final net Rp5,074,000 |
| Rp100k negative correction after the regular+THR example | Tax adjustment −Rp7k; recovery receivable debit Rp93k; cash unchanged |
| Fully approved unpaid month, Rp10m BPJS wage basis | Gross/net cash zero; employee recovery receivable debit Rp400k; BPJS payable Rp1,424,000 |

Fixtures confirm their own rates; these numbers are not production policy defaults.

## Verification and limits

Tests use a dedicated disposable PostgreSQL 16 container and newly created company data, not the running business database. `lib/__tests__/payroll-immediate.test.ts` covers each of the four original defects. `payroll-rules.test.ts` covers PTKP, annual tax, daily overtime and dated BPJS. `integration/payroll-correctness.int.test.ts` exercises real create/calculate/post/approval/edit routes with fixed GL values, monthly/final reconciliation, duplicate/concurrent runs, missing setup and complete refusal snapshots. `e2e/payroll-correctness.spec.ts` uses the employee, settings, attendance and payroll screens, including THR/correction and exact ledger checks.

Run normal unit tests, both TypeScript projects and builds. For database/browser acceptance, point DATABASE_URL at a disposable base database and use `test:int:setup` / `test:e2e:setup` before the corresponding suites. Those scripts derive `_test` / `_e2e` databases and rebuild them. Never point them at a business database.

Supported tax scope is ordinary resident monthly employees with complete current-company payroll history. This does not implement PPh 26, partial-year tax-residence annualization, prior-employer A1 imports, special severance tax, rotating shift calendars, holiday discovery, THR entitlement calculation or submission of tax/BPJS returns. Existing incomplete historical salary data requires verified history entry before final reconciliation; this change does not create a historical-import screen or rewrite past payroll. Finance must confirm policy values, unusual employment cases, leave entitlement and examples before release.

## Primary references

- [PMK 168/2023](https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf): taxable employer premiums, final-period deductions and settlement.
- [PP 58/2023 TER tables](https://jdih.kemenkeu.go.id/api/download/e47c3fc4-a912-4bf1-bcad-335fee3f71f8/2023pp058.pdf) and [DJP category explanation](https://www.pajak.go.id/index.php/id/artikel/simpel-pakai-ter-begini-penjelasannya).
- [DJP PTKP](https://www.pajak.go.id/id/penghasilan-tidak-kena-pajak).
- [PP 35/2021](https://jdih.kemenkoinfra.go.id/cfind/source/files/pp/2021/salinan-pp-nomor-35-tahun-2021.pdf), Articles 31–33: daily overtime bands and wage basis.
- [BPJS contribution explanation](https://www.bpjsketenagakerjaan.go.id/artikel/18901/artikel-cara-mendaftar-sebagai-peserta-pu-bpjs-ketenagakerjaan.bpjs). JP ceilings must be confirmed for their effective cycle. The 2026 QA example uses Rp11,086,300 from March per BPJS letter B/1226/022026, dated 25 February 2026 ([hosted copy of the signed letter](https://494075.fs1.hubspotusercontent-na1.net/hubfs/494075/compliance-portal/notification-number-b1226022026.pdf)).
