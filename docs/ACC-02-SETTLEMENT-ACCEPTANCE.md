# ACC-02 settlement and close browser acceptance — 2026-10-21

Base: main `b4e6157`. Reconciliation #191, cutoff history #196, settlement #192
and migration-opening acceptance #197 are merged. This increment verifies the
remaining browser workflow; it changes no production posting code or policy.

## Real actors and screens

`e2e/settlement-close-acceptance.spec.ts` has four cases, customer and supplier
versions of two journeys. Each creates a separate QA company and two signed-in
administrators in separate browser contexts. The fixture requires distinct
approvers even for administrators. The preparer saves actual payment forms; the
reviewer approves/rejects through the actual Approval Inbox. Recorded requester
and reviewer IDs must match those separate users. Self-approval returns 403 and
changes no payment, document, request, allocation or journal.

Document creation uses the real APIs (service invoice or service bill), not the
invoice/bill form. Policy, users and membership are fixture setup, not a Settings
screen acceptance claim. No live company or production database is used.

## Fixed accounting example, independently checked on both sides

A posted invoice/bill totals 1,000.01. All receipts/payments are dated 15 September.

| Step | Cash for this payment | Discount | Fee | Debt cleared | Debt still owed |
| --- | ---: | ---: | ---: | ---: | ---: |
| First approved payment | 560.20 | 50.10 | 10.05 | 600.25 | 399.76 |
| Second approved payment | 399.75 | 0 | 0 | 399.75 | 0.01 |
| Final approved payment | 0.01 | 0 | 0 | 0.01 | 0 |

Cash + discount - fee equals debt cleared. Pending payments change neither GL nor
settlement. One cent owing keeps the invoice Sent / bill Open. Checks use fixed
expected values in document status, settlement, aging, per-control reconciliation
and independent posted journal sums, including cash, discount and fee sides.

The Company Setup close dialog refuses pending financial approvals, with the
Close period button disabled and a direct close request also refused with 422.
At one cent owing (with no pending approvals), close succeeds. The payment form
shows the closed-period banner; a valid final-cent save is refused with 422 and
unchanged full document/payment/allocation/request/journal snapshots. The reviewer
reopens through the same screen, and the preparer can save and settle the last cent.

After closing September again, voiding the first payment through its real API on
the later current date restores 600.25 owing. Cash is 399.76 in the appropriate
AR/AP direction, with discount and fee balances zero. The 30 September aging,
control GL and reconciliation stay at zero owing; the later dated reconciliation
shows 600.25, without a forced adjustment. This void is an API action, not a catalog
Void-button journey. The current cutoff uses the company's Jakarta business date.

## Rejection and failed approval

Two real full-payment form submissions await approval for the same 1,000 debt.
The first is approved through the reviewer inbox. The second then fails approval
with 422, displays its over-allocation error, remains Pending and stays visible.
Complete document, payment/allocation, approval-request and journal snapshots match
before/after refusal. The reviewer rejects it using the inbox reason field; the
payment returns to Draft and no extra journal or settlement appears.

These are fixed browser examples of the merged guards, not a new reservation policy.
No production defect or posting change was required in the exercised paths.

## Reproduce

Prepare isolated PostgreSQL 16 and an explicit DATABASE_URL; generate the matching
Prisma client, apply migrations and run `scripts/e2e-db-setup.mjs`. Playwright uses
the derived `_e2e` database, separate from integration `_test` fixtures.

```text
node node_modules/@playwright/test/cli.js test e2e/settlement-close-acceptance.spec.ts e2e/payment-allocation.spec.ts e2e/note-settlement-status.spec.ts e2e/control-close-policy.spec.ts e2e/period-close.spec.ts e2e/closed-period-banner.spec.ts --project chromium
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader runner settlement-acceptance control-reconciliation report-reconciliation migration-opening-acceptance control-close-policy payment-settlement-status
```

## Verification and limits

- Final fresh-fixture Chromium run: all 15 cases pass, including the four new
  cases and existing payment-allocation, note-settlement, control-close, monthly
  close and closed-banner journeys. Local retries were disabled.
- All 60 related PostgreSQL cases pass across the six suites in the command above.
- Application and browser-test TypeScript checks pass.
- Full unit/build and whole-database suites were not rerun locally for this
  test/documentation-only change; CI runs the full configured checks.

An earlier combined browser run stopped receiving a payment-form response and
was interrupted; its cause was not established. The final tests have 30-second
operation limits and explicit failure on unexpected form alerts. The focused
journey and final combined run pass from fresh fixtures; no failure was suppressed
or converted to an expected failure.

## Remaining acceptance

#167 stays open for finance review of these examples, production read-only account
scope/reconciliation checks, migration-screen acceptance, a Reports screen for
per-control reconciliation, and authorized deployment/pilot/release verification.
The older CSV-opening import's once-only guard remains a separate follow-up
recorded by #197. Structured original/reversal links remain a schema follow-up.
#164 note-cap policy and #166 draft-return deletion are separate work. Full
inventory/month-end acceptance still depends on #170. No migration, historical
rewrite, production query, deployment or merge is performed here.
