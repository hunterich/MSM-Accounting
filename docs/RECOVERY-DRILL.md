# Full-system recovery drill

Status: Windows Docker deployment recovered and core deployed-system checks passed
on 2026-10-08. Target: `haely-linux`. Expanded file and accounting reconciliation
coverage remains open as described below.
Read-only SSH preflight succeeded as `haely-linux@192.168.68.102`: hostname
`haely-linux-M8`, about 11 GiB RAM and 1.7 TiB free disk. Docker was initially absent;
no backup directories were found at `~/backups`, `~/msm-backups` or `/data/backups`.
The existing local deployment mounts `deploy/backups` at `/data/backups`. Its
latest file found was `msm-pre-upgrade-20260930-6d0c89d.dump` (about 2 MiB).
Use a fresh snapshot for current recovery validation, or explicitly record the
September 30 snapshot date/version if testing that historical backup instead.
Homelab preparation is now complete with the operator's authorization: Docker
29.1.3, Compose 2.40.3 and Buildx 0.30.1 from Ubuntu repositories; Docker starts
on boot and `haely-linux` can use it from a fresh login. Container execution,
PostgreSQL 16.15 dump/restore tools, SQL connectivity and Caddy 2.11.7 passed.
No homelab login password is stored in project files. A fresh read-only snapshot
of the Windows database was subsequently restored into the isolated target.

The isolated staging workspace is `/home/haely-linux/msm-recovery-drill` with
private backup/evidence/attachment directories and a generated staging-only
database password in a mode-0600 `.env`. Background jobs and business automation
are disabled there. The healthy `msm-recovery-drill-db-1` container uses the separate
`msm-recovery-drill_recovery_pgdata` volume and listens only on `127.0.0.1:5546`.
The recovered backend and web images now run there, served at
`https://192.168.68.102:8446`. The portable database template is
`deploy/recovery.compose.yml`; the host's `compose.yml` additionally defines the
exact recovered app images, separate Caddy volumes and staging backup/file mounts.
The staging TLS CA is independent; browsers may require its public root certificate
to be trusted. Its certificate is in `evidence/recovery-root.crt`.

No additional operator input was needed for this snapshot: the running Windows
containers supplied the database and images. Existing Windows email/password
credentials remain valid on the recovery copy. QA added two staging-only users
and one view-only role after baseline verification; the admin QA credentials are
stored in the private host `qa-login.json`, not in tracked source.

## Verified result — 2026-10-08

- Snapshot captured at `2026-10-08T04:16:05.025Z` (11:16 Jakarta) using an exported
  repeatable-read snapshot shared by `pg_dump` and per-table fingerprints.
- All transferred dump/image/manifest files passed SHA-256 verification. PostgreSQL
  16 restore completed without errors. At 04:18:07 UTC, all 93 public tables / 56,383
  rows had identical counts and sorted row-content fingerprints to the source.
- Exact backend image: `sha256:04f0dffbf960fb401748fdd3621b95bc361c692c53b831062db5711554b1adbc`.
  Exact web image: `sha256:805ab9befdeef147fe4a8b3bb26127bd7153db366445f97ecf8e997e6c3c8502`.
  Both represent deployed revision `6d0c89d638713802ce3ea4b6856d994efcde846f`;
  the unreleased scheduler changes were not applied to this matching-version restore.
- HTTPS frontend returned 200 by 04:19:53 UTC, about four minutes after snapshot
  capture. This is an observed drill duration, not a production recovery SLA.
  TLS was separately verified against the staging CA, without bypassing validation.
  Browser automation used an isolated context that accepts this private CA.
- Real browser sign-in, company selection and invoice/bill/journal/report screens
  passed. Existing invoice and bill detail APIs, payment/item/journal lists, trial
  balance, balance sheet, profit/loss and AR/AP aging returned 200.
- Direct posted-ledger aggregate (22,687 lines through October 8) and trial-balance
  report agreed: debit and credit both `502,788,116.26`; ending debit and credit
  both `251,894,058.13`. All financial tables matched source fingerprints before QA.
- Unrelated-company access returned 403; a view-only user could not post (403).
  Temporarily locking the drill date's period rejected admin posting (422); its
  original lock state was restored. Source periods were all open.
- A labelled 123.45 entry and compensating reversal posted successfully. Every
  account's net ending balance remains identical to the pre-test report. Gross
  debits/credits each increase by 246.90, as expected for the two test entries.
  A zero-balance account becomes visible in the report because it now has activity.
- All three containers restarted and HTTPS login/reports/screens passed again at
  04:23:30 UTC. Intentional staging changes are confined to account posting flags,
  period timestamp, audit entries, backup settings, two journals/four lines, QA
  roles/permissions/users/memberships. Other 83 tables retain source fingerprints.
- Source `BillAttachment`, `SalesInvoiceAttachment` and `BillImportSession` each
  have zero records, and the deployed backend had no `/app/.data` directory.
  No attachment files were omitted from this observed deployment; positive file
  recovery still needs a dataset containing files.

Evidence is local at `artifacts/recovery-drill/20261008-windows/` (Git-ignored):
source manifest/checksums, database dump and image archive, application verification,
trial balance before/after, four browser screenshots, and copied host `evidence/`
containing restore verification, container mounts, accounting and write checks.
Capture script: `scripts/recovery/capture-windows.mjs`; repeatable read-only browser
smoke: `scripts/recovery/smoke-homelab.mjs` (requires the private staging QA login).

Remaining: actual attachment download/print recovery; multi-company switching;
independent AR/AP-to-GL and inventory-to-GL reconciliation. These are coverage gaps,
not observed restore mismatches. The snapshot contains one company. Keep this QA
copy isolated; automatic billing and email remain disabled.

## Repeat procedure

1. Read-only preflight: confirm hostname, free RAM/disk, Docker/Compose versions,
   PostgreSQL major version, available application images, backup size and checksum.
   Record the production backup timestamp, database counts and key control totals
   from the same snapshot, so later changes in production do not invalidate comparisons.
2. Use a unique Compose project (`msm-recovery-drill`) with independent PostgreSQL,
   Caddy and attachment volumes. Use a separate hostname/ports; verify the resolved
   database and mount paths are staging paths before restoring anything. Never reuse
   a production database, volume, synced folder or destination.
3. Start only PostgreSQL 16, restore the dump with `pg_restore --exit-on-error`
   into the empty drill database, and preserve restore logs. Restore attachments
   from the same snapshot to a separate staging directory. The database stores
   attachment references; a database-only dump is not proof that files were recovered.
4. Start the matching backend and frontend image with `BACKGROUND_JOBS_ENABLED=false`,
   `BUSINESS_AUTOMATION_ENABLED=false`, no `RESEND_API_KEY`, and staging-only backup
   directories. The first switch suppresses backup, PO auto-close, billing and
   notification jobs in versions that implement that switch. Older images (including
   the recovered September 30 image) require disabling `BackupSettings.enabled` in
   staging after fingerprint comparison and before starting the app. Clear restored
   backup destinations and use staging paths.
   Do not upgrade the schema until the matching-version restore has been verified.
5. Compare account/document/allocation/journal/stock counts and sums against the
   snapshot. Check trial balance, AR/AP control accounts versus subledgers, inventory
   valuation versus GL, accounting-period locks and company memberships.
6. Open the restored app over staging HTTPS. Sign in, switch companies, open old
   invoices/bills/payments, load and download attachments, print documents and view
   dated reports. Verify a view-only account cannot post. After recording baseline
   totals, make a clearly labelled test transaction and reversal in the staging copy.
7. Record backup age (RPO), elapsed restore/startup time (RTO), versions, checksum,
   checks performed, mismatches and screenshots. Mark the drill passed only when
   database, external files and application checks all pass. Store evidence locally
   in `artifacts/recovery-drill/`; exclude backups and secrets from Git.
8. Agree whether to keep the staging copy for QA or remove its exact Docker project
   and volumes after the evidence is reviewed. Do not delete an unverified target.

An outbound email/provider check is a separate opt-in staging test using an
operator-controlled address. Scheduled billing, retries and notifications must not
be enabled against restored production recipients during this drill.
