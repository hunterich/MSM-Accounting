# Performance fixes verified October 7, 2026

The production-build retest used synthetic data and disposable services only.
The live application and production database were unchanged.

## Changes

- POS reserves its payment sequence before the journal sequence, matching AR
  receipts and removing the observed advisory-lock deadlock.
- Dashboard aging aggregates in PostgreSQL instead of loading every invoice
  and allocation into Node.
- AR payment create/update maps `cashAccountId` to `depositAccountId` and
  rejects conflicting account IDs.
- Both Compose configurations allocate 1 GiB of PostgreSQL shared memory.
  The original 64 MiB configuration failed concurrent large reads with 53100.

## Measured results

| Authenticated HTTP users | Duration | Requests | Failures / timeouts | Request p95 |
| --- | --- | --- | --- | --- |
| 5 | 602 seconds | 6,328 | 0 / 0 | 99 ms |
| 10 | 602 seconds | 12,501 | 0 / 0 | 107 ms |
| 20 | 603 seconds | 23,496 | 0 / 0 | 195 ms |

The stages ran sequentially after 350,000-order and 500,000-order read tests.
Both read benchmarks passed; the larger fixture contains 5,000,103 synthetic
transaction rows. The latest timings are in `capacity-benchmark.latest.json`.
At 500,000 orders, the dashboard warm response fell from 3.20 to 0.50 seconds.
Highest sampled backend memory fell from 2.81 to 1.26 GiB. PostgreSQL peaked at
3.03 GiB, up from 2.48 GiB in the baseline. Resource samples were approximately
15–17 seconds apart and exclude browser/load-generator and Docker VM overhead.

All final journal, settlement, stock and control-account invariants passed.
The workspace passed 1,149 unit tests, TypeScript checking and production
compilation. Six real-PostgreSQL regression tests passed. Restoring the original
POS lock order inside a disposable container reproduced a 40P01 deadlock and
failed the new coordinated regression, confirming that it detects this defect.

## Workload and limits

Each virtual user had independent valid fixtures, authenticated sessions and
two-second think time. Loops mixed browsing, reports, approved invoice posting
and AR receipts, expense bills and AP payments, and cash POS checkout. Sequential
replay checks covered payments, approval and checkout. Writes used a separate
small posting company; reads used the large historical company. These results
do not measure historical-company posting, shared-item contention, concurrent
duplicate races, WAN clients, bulk import or a full-day soak.

The image was built from base revision
`9f3439ee5da19ce1cc698c0ee2c901257c58e05c` plus the recorded workspace changes;
image ID `sha256:8c88024daf187ae1d43da55525ca5a2905d7bb0846a67627717fcfb9bab61348`.
That workspace also included separate, unmerged pagination changes. Browser
invoice navigation and the workspace unit count include that pagination work;
they are not verification of the performance-only Git revision. Product fix
source hashes match the tested build. An isolated checkout of the performance
commit passed TypeScript checking and all 1,139 unit tests in 152 files without
the pending pagination changes. Raw evidence remains local under
`artifacts/performance-test` and `artifacts/performance-fix`; it is excluded from
Git and Docker contexts alongside local database backups.

## Reproduction

The Windows scripts use the local Docker Desktop executable and read the image
IDs of the existing backend/web services. They create separate test services,
network and database; they do not change the live services. Update the Docker
executable paths when using another workstation. Run from the repository root
with Node dependencies and Playwright Chromium installed.

```powershell
$env:PERFORMANCE_DIR = 'artifacts/performance-fix'
$env:PERFORMANCE_IMAGE = 'msm-performance-fix:20261007'
# The browser selectors depend on the separate invoice-pagination changes.
# Until those are merged, explicitly skip browser measurements:
$env:PERFORMANCE_SKIP_BROWSER = '1'
./scripts/performance-setup.ps1
node scripts/performance-run.mjs
node scripts/performance-fix-report.mjs
./scripts/performance-cleanup.ps1
```

Use a fresh results directory for a new run; the harness can resume existing
results. Cleanup removes only the known disposable test services and database
volume. The application build and updated Compose configuration still require
live deployment. Recreating the database container is needed to adopt its new
shared-memory setting; no new migration is introduced by these fixes.
