# Windows and homelab deployment — 2026-10-08

PR [#146](https://github.com/hunterich/MSM-Accounting/pull/146) merged as
`3be13ca55f4ac19bdfe9ad81255112ec8a9f9410`. Both installations use the matching
backend and web image tag `sha-3be13ca`; OCI revision labels were checked against
that full commit before migration. CI run 37730873927 passed all checks, including
PostgreSQL integration, browser journeys, dependency security and both builds.
Image publication run 37731474036 passed.

## Installed and verified

| Installation | URL | Background jobs | Business billing |
| --- | --- | --- | --- |
| Windows Docker | https://localhost | Enabled | Enabled |
| Homelab recovery copy | https://192.168.68.102:8446 | Disabled | Disabled |

Five migrations applied successfully on each server: sales-return original
cost, purchase-order auto-close, asset purchase bill, capacity indexes, and
`20261008090000_billing_notifications`. Existing database and Caddy volumes were
preserved. Fresh pre-upgrade database backups and previous image tags were saved.

Deployed checks passed before and after service restart: authenticated sessions
(real password login on homelab), invoice/bill/payment/journal/item retrieval,
trial balance and AR/AP aging, catalog/report navigation, security headers and
HTML cache controls. The new update board opens, closes, stays dismissed after
refresh, and reopens from the bell.

Posted ledger totals and line counts remain identical to each pre-upgrade
baseline:

| Installation | Posted lines | Debit | Credit |
| --- | ---: | ---: | ---: |
| Windows | 22,687 | 502,788,116.26 | 502,788,116.26 |
| Homelab | 22,691 | 502,788,363.16 | 502,788,363.16 |

The homelab difference consists of the recovery drill's test posting and
compensating reversal. Both trial balances retain ending debit and credit totals
of 251,894,058.13. Baseline preservation does not certify subledger correctness.

Windows' business sweep created its payment checkpoint, which advanced again
after restart. Homelab has no automation checkpoints, as expected with its jobs
disabled. There are currently no recurring templates or subscriptions on Windows.

## Email and remaining work

The operator deferred email-provider setup and requested disabling finance email.
Payment alerts, invoice reminders and daily summaries are off on both servers;
the finance address is retained. Notification delivery tables contain zero rows.
The recipient is a company setting under Settings → Notifications, not a user
account address. Later enablement requires a Resend API key, verified sender,
the desired company toggles and a controlled delivery test.

Still required: live due-template generation with approval/locked-period cases
and duplicate-free document replay; Google sign-in under CSP, old-tab upgrade
recovery and POS worker scope; campaign and concurrent-stock capacity; recovery
with actual attachments and multiple companies; AR/AP/inventory reconciliation.
See ROADMAP.md, BUSINESS-AUTOMATION.md and RECOVERY-DRILL.md.

Private backups, configuration copies, screenshots and machine-readable results
are kept in Git-ignored `artifacts/deploy-20261008/` on Windows and
`/home/haely-linux/msm-recovery-drill/backups/` on homelab. Secrets and database
contents are not committed. Separate in-progress dashboard work was preserved
and excluded from the release images.
