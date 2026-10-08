# Automatic billing and finance notifications

Implemented on 2026-10-08 for the long-lived Next.js API container. This is an
application scheduler, not a Codex reminder. Release `sha-3be13ca` was deployed
to Windows and homelab on 2026-10-08; see `docs/DEPLOYMENT-20261008.md`.
Windows scheduling is enabled. Homelab background jobs stay disabled for recovery
testing. Finance emails are disabled on both installations at the operator's
request until provider credentials and a verified sender are configured.

## Enable on the server

1. Deploy the matching application images and apply Prisma migrations, including
   `20261008090000_billing_notifications`. Both Compose files pass the new settings
   to the backend. Apply migrations before starting the new scheduler.
2. Review active recurring invoice/bill templates and subscriptions, especially
   overdue dates, auto-post choices, stock, customer/vendor accounts and approval
   settings. Every billing company needs an active ADMIN membership on an active
   account/role for approval attribution. Disabled company features are skipped.
3. Configure the company's Finance Notification Email and desired toggles in
   Settings → Notifications. The operator authorized financial details to that
   address on 2026-10-08. Automatic messages go to finance; customer email stays
   manual. Reminders include outstanding amounts after completed allocations,
   payment discounts and applied gross credit notes.
4. For billing, set `BUSINESS_AUTOMATION_ENABLED=true` in `deploy/.env` and
   recreate the backend. Email additionally requires `RESEND_API_KEY`, a verified
   `EMAIL_FROM_ADDRESS`, and the company's desired notification toggles.
   Keep secrets in the server environment. Set `BACKGROUND_JOBS_ENABLED=false`
   to suppress every startup scheduler on restore/QA copies. No live email was
   sent while developing; tests inject a fake sender.
5. Verify a disposable/staging template and a finance address you control. Check
   invoice/bill, approval, journal and template dates; confirm no duplicate on
   restart. Verify provider delivery and inspect backend logs before relying on
   production scheduling. Add full browser journeys as tracked in ROADMAP.md.

## Behavior

- Startup and every 15 minutes: attempt one due occurrence per recurring template
  and one due subscription period. Recurring template IDs are paged in batches of
  100; processing is sequential. Large historical backlogs catch up gradually,
  one occurrence per sweep. Templates retain their scheduled issue date; missed
  dates in closed/restricted periods fail for review instead of being silently
  redated or overriding the lock.
- Approval-required live documents are held; draft templates do not post journals.
  Template locks and selected-date rechecks serialize recurring batch/manual work.
  Subscription claims compare the selected date and period. Failed documents roll
  back and remain due. Failures are logged independently of other jobs/companies.
- Payment alerts: poll new COMPLETED AR/AP payments every 15 minutes. The first
  scan establishes a baseline; old payments are not flooded to finance. A persistent
  checkpoint supports restart catch-up and a one-hour overlap handles delayed
  commits. Disabled alerts advance the baseline; re-enabling does not backfill
  disabled periods. Transactions committing more than an hour after their timestamp
  need operational review. Alerts are keyed by payment ID and kind.
- After 08:00 in each company timezone: at most one due/overdue reminder digest
  and one previous-day activity digest. A late start still sends that day's digest.
  The reminders show the first 20 invoice references plus the full count/total.
  Summary totals use document dates and current live/completed statuses; they are
  an activity snapshot, not a reconstructed historical financial statement.
  Missed daily digests during a prolonged outage are not backfilled.
- Delivery: database outbox, conditional leases, current-toggle/recipient checks,
  stable Resend idempotency keys and up to five retry attempts. No provider key
  means queued messages remain unsent. Changed recipients or disabled toggles
  cancel old queued messages. An uncertain attempt older than 23 hours is marked
  FAILED for review before the provider's [24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys) expires.

## Monitoring and remaining work

Review `[business-automation]` and `[finance-notifications]` backend logs. Inspect
`NotificationDelivery.status`, `attempts`, `sentAt` and `lastError` for delivery
failures; the unique organization/key prevents enqueue replay. Failed deliveries
are not blindly retried by clearing their status: confirm the provider outcome
first. The outbox is operator-visible in the database; an in-app job history and
manual retry UI are not implemented. Define retention before long-term high-volume
use. Serverless hosts need a separate authenticated job runner; process cron
requires a continuously running backend.

Remaining release checks: live migration/enablement, verified sender/provider
delivery, offline-server restart catch-up, calendar boundary behavior, campaign
volume and full UI billing/approval/notification journeys. See ROADMAP.md and
docs/TESTING.md. Full recovery validation is tracked in docs/RECOVERY-DRILL.md.
