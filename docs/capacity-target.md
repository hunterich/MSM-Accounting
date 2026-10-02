# Marketplace capacity target

The supplied 2025 Shopee screenshot shows 174,917 orders. TikTok is reported to
run a similar volume. Use **350,000 orders per year** as the minimum baseline,
approximately 960 orders per day on average. This average does not establish
campaign peaks or simultaneous user counts. The earlier accounting screenshot
shows 4,964,861 data items, whose mapping to this application's tables is unknown.

## Changes implemented

- Trial balance, balance sheet, profit and loss, comparison periods, cash flow
  statement, and account-ledger opening balances now sum journal lines in
  PostgreSQL and return one row per account.
- Stock valuation now sums the immutable inventory ledger in PostgreSQL and
  returns one row per item, preserving the same valuation source as the GL.
- Customer, item, item/customer, top-product, daily, monthly, and share sales
  summaries aggregate in PostgreSQL. Their former 100,000-transaction cap no
  longer prevents annual summaries. Existing response fields are preserved;
  calendar buckets explicitly use Asia/Jakarta. For description-based item
  groups with multiple codes, the displayed code is the smallest code rather
  than an arbitrary code from the first fetched line.
- A pending migration adds indexes for posted journal queries, live invoice
  date queries, and marketplace order-number duplicate lookups.

## Database benchmark

Run only against an **already migrated disposable database** whose name ends in
`_capacity_test`. The runner refuses other database names and does not create,
reset, or drop a database. Use a test PostgreSQL instance with server hardware
representative of deployment. Apply the repository migrations to that test
database before running the benchmark.

```powershell
$env:CAPACITY_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/msm_capacity_test'
npm run bench:capacity

# Larger history scenario: approximately five million transaction-table rows
$env:CAPACITY_ORDERS = '500000'
npm run bench:capacity
```

The default fixture creates 350,000 invoices, two lines per invoice, four
journal lines per order, two inventory movements per order, and initial stock
and its opening journal. It has two marketplace customers and 100 products.
The larger run creates 5,000,103 rows across these transaction tables. These are
synthetic workload assumptions, not a reconstruction of the existing database.
The fixture is inserted in bulk; seeding does **not** test application posting
or import throughput. Cleanup removes only the runner's organization and rows.

The runner validates sales totals, invoice counts, monthly totals, units sold,
balanced journal totals, and inventory quantity/value. It measures five warm
samples after a warmup, including eight concurrent sales/GL readers. The reported
p95 is the maximum of those five samples, a preliminary check rather than a
long-duration performance study.

Initial acceptance targets (to validate on deployment hardware):

| Operation | Target |
| --- | --- |
| Annual sales, monthly chart, top products, trial balance, valuation | warm p95 ≤ 5 seconds each |
| First invoice page of 50 with line items and total count | warm p95 ≤ 2 seconds |
| Eight concurrent sales/GL readers completing as a batch | warm p95 ≤ 10 seconds |

Successful execution saves timings and correctness status to
`docs/capacity-benchmark.latest.json` and exits unsuccessfully if a target is
missed. No successful capacity result has been recorded in this work session:
there is no configured test database or reachable local PostgreSQL server.

## Remaining release validation

The changes above do not establish whole-system capacity. Before relying on the
system at this volume, run the benchmark on the intended server and measure:

- Import/posting throughput and marketplace retry/duplicate behavior during
  campaign peaks, including simultaneous writers.
- Dashboard, receivables/payables aging, search, deep list pages, and reports
  with many distinct customers or descriptions.
- Transaction-detail report pagination/streaming and export behavior. These
  paths still return detail rows; sales returns retain the 100,000-row safety
  cap and sales history still returns the latest 500 invoices.
- Browser responsiveness, HTTP latency, database disk growth, peak memory,
  connection limits, cold-cache behavior, backups, and restore time.

Production readiness must be based on those measurements. The pending index
migration has not been applied to any deployment in this session.
