# Backup & Restore — Design Spec

**Date:** 2026-06-23
**Status:** Approved design, pending implementation plan
**Author:** brainstormed with the product owner (non-technical accountant)

---

## 1. Context & Problem

MSM Accounting Software is a multi-tenant Next.js + Prisma + PostgreSQL app (74
models, all scoped by `organizationId`). For this customer it is deployed on a
**single office computer/server** that runs the app **and** the Postgres
database; other users connect to it over the local network from a browser.

Today there is **no database backup feature** — only in-app CSV/PDF/Excel
*export* of individual lists/reports. The ROADMAP lists "Backup & restore
functionality — Not started — High". The data is irreplaceable (and, for
Indonesian tax compliance, must be retained ~10 years per Pasal 28 UU KUP), so a
real, automatic, restorable backup is needed.

An earlier stopgap (macOS LaunchAgent + `pg_dump` shell script on the owner's
dev Mac) proved the mechanics but is machine-specific and does not belong in the
product. This spec replaces it with an **in-app, server-side feature** that
travels with the app regardless of the host OS.

## 2. Goals (v1)

- Full-database backups via `pg_dump` custom format, restorable via `pg_restore`.
- **Automatic schedule**, default **ON**, **twice daily at 13:00 and 20:00**.
- Retention: keep the **last 30 daily** backups **+ a monthly** copy for **12 months**.
- **Manual "Back up now"** on top of the schedule.
- **Destinations** — all "save into a folder", multi-select (more = safer):
  1. **External drive / folder** — a folder path on the office machine.
  2. **Google Drive** — the Google Drive desktop app's synced folder on the office PC.
  3. **OneDrive** — the OneDrive synced folder on the office PC.
  4. **Download** — stream a backup file to the admin's browser.

  (1–3 are the same mechanism: a configured folder path. The cloud apps sync
  their folders offsite by themselves — no sign-in/credentials inside our app.)
- **Restore** from history — admin-only, guarded (safety backup first, type-to-confirm).
- **History** list: when, type (auto/manual), size, destinations, status; with download.
- English UI under **Settings → Backup & Restore**.
- Admin-gated via a new RBAC key.

## 3. Non-Goals (v1) — deliberately deferred

- **Direct cloud sign-in (OAuth)** to Google Drive or OneDrive. Cloud is handled
  the simple way — by saving into the cloud app's **synced folder**. Direct API
  upload (no desktop app needed) is a possible future enhancement, explicitly
  dropped now to avoid technical setup (Google Cloud credentials, tokens).
- **Backup-file encryption / passphrase** (rely on folder + OS permissions for now).
- **Point-in-time / WAL / incremental** backups (full dumps only).
- **Per-organization data export** (a different feature — this is whole-DB).
- **Automated maintenance-mode lockout** during restore (warn users instead).
- Non-Postgres database engines.

## 4. Architecture

All work happens in the **Next.js backend on the office server**, which already
holds `DATABASE_URL`.

```
Settings UI ──> /api/v1/backup/* ──> BackupService
                                        ├─ pg_dump / pg_restore (child_process)
                                        ├─ Destination handling:
                                        │    • FolderDestination (canonical + each configured folder)
                                        │    • DownloadDestination (HTTP stream)
                                        ├─ RetentionPruner (canonical + each folder)
                                        └─ records → BackupRecord (DB)
Scheduler (in-process, node-cron) ──> BackupService.create({type: AUTO})
```

- **Canonical store:** every backup is written **first** to a canonical folder on
  the server (configurable; default app-data dir, must be writable and never
  web-served), **then** copied to each enabled destination folder. The canonical
  copy is authoritative; destination copies are best-effort (one failing/unmounted
  folder never loses the backup).
- **Cloud = a folder.** Google Drive and OneDrive are just folder paths that their
  desktop sync apps keep mirrored offsite. The app only does an ordinary file
  copy into those folders — identical code path to an external drive folder.
- **pg_dump / pg_restore:** invoked via `child_process`. Binary path is
  auto-detected per-OS (PATH → common install dirs: Windows
  `C:\Program Files\PostgreSQL\*\bin`, macOS Homebrew, Linux `/usr/bin`) with a
  **Settings override** field. If not found, the UI shows a clear, actionable error.
- **Format:** `pg_dump --format=custom` (compressed, selectively restorable).

## 5. Data Flow — Create

1. Acquire a single-run lock (skip if a backup is already running).
2. `pg_dump --format=custom` → `canonical/msm_accounting_<ISO-stamp>.dump`.
3. For each enabled destination folder: copy the file; capture per-destination
   `{label, path, status, error}`. A folder that is missing/unmounted (e.g.
   external drive unplugged) → that destination is `SKIPPED`, others proceed.
4. Insert a `BackupRecord` with aggregated status:
   `SUCCESS` (all ok) · `PARTIAL` (some skipped/failed) · `FAILED` (dump failed).
5. Run retention pruning on the canonical store and each destination folder.

### 5.1 Impact on staff while running (concurrency)

- **Backups are non-disruptive.** `pg_dump` reads a consistent MVCC snapshot and
  takes only `ACCESS SHARE` locks, which do **not** block normal INSERT/UPDATE/
  DELETE. Staff continue working normally during a backup; their changes simply
  appear in the next backup. No freeze, no logout, no read-only mode. (At this
  data scale a backup completes in well under a second regardless.)
- **Restore IS disruptive** and is the exception — see §10. It replaces the
  database, so staff must be logged off while it runs. Restore is an emergency-
  only action, so this is acceptable.

## 6. Data Model (new Prisma models — system-level, no `organizationId`)

A whole-DB backup spans all organizations, so these are **system tables** gated
by a system-admin permission (not per-tenant).

- **BackupSettings** (single row):
  `enabled`, `frequency` (`TWICE_DAILY` default | `DAILY` | `WEEKLY`),
  `times` (Json, default `["13:00","20:00"]`), `retentionDailyCount` (30),
  `retentionMonthlyCount` (12), `canonicalDir`,
  `folderDestinations` (Json: `[{label, path, enabled}]` — e.g. External, Google
  Drive, OneDrive, or any folder), `downloadEnabled`, `pgToolsPathOverride?`,
  `updatedAt`.
- **BackupRecord**:
  `id`, `createdAt`, `type` (`AUTO` | `MANUAL` | `PRE_RESTORE_SAFETY`),
  `fileName`, `sizeBytes`, `status` (`SUCCESS` | `PARTIAL` | `FAILED`),
  `destinations` (Json: `[{label, path, status, error}]`),
  `durationMs`, `triggeredByUserId?`, `error?`.

No cloud tokens/credentials are stored (cloud is just a folder), so there is no
connection table and no token-encryption secret to manage.

## 7. API (Next.js, `/api/v1/backup/*`, all admin-gated)

- `GET  /settings` → settings + folder-writability checks + pg_tools detection status.
- `PUT  /settings` → update schedule / retention / folder destinations / paths.
- `POST /run` → manual backup (`type: MANUAL`); returns the `BackupRecord`.
- `GET  /history?page=` → paged `BackupRecord` list.
- `GET  /:id/download` → stream the canonical `.dump` (admin-gated).
- `POST /:id/restore` → guarded restore; body must include `confirm: "RESTORE"`.

(No Google/OAuth endpoints — removed with the synced-folder decision.)

## 8. Cloud via Synced Folder (Google Drive / OneDrive)

- The office PC has the **free desktop sync app** (Google Drive for desktop and/or
  OneDrive) installed and signed in **once**. This is the normal consumer
  "log into Google Drive" — not a developer/credentials setup.
- Each cloud then exposes a **local folder** (e.g. `G:\My Drive\...` /
  `~/Library/CloudStorage/GoogleDrive-...`, `OneDrive\...`). The admin adds that
  folder path as a destination in the Backup screen.
- The app writes the `.dump` into that folder; the sync app uploads it offsite
  automatically. Retention deletes old `.dump` files from the folder, and the
  sync app removes them from the cloud too.
- **Requirement to surface in the UI/docs:** if a chosen cloud folder doesn't
  exist (sync app not installed/signed in), the screen shows a clear "this folder
  isn't available — install/sign in to Google Drive (or OneDrive) on this
  computer" message, and that destination is skipped (others still run).

## 9. Scheduler

- In-process **node-cron** jobs derived from `BackupSettings.times`.
- Re-initialised on server boot from the DB; rescheduled whenever settings change.
- Single-run lock prevents overlap.
- **Requires a long-running server process** — valid here (the office server is
  always on). Documented that serverless hosting would need an external trigger
  (not applicable to this deployment).

## 10. Restore (guarded)

Admin-only. `POST /:id/restore` with `confirm: "RESTORE"`:

1. Create a `PRE_RESTORE_SAFETY` backup first.
2. (v1) Warn in the UI that other users should log off; set a lightweight
   maintenance flag if cheap to add, otherwise warn only.
3. `pg_restore --clean --if-exists --no-owner --dbname=$DATABASE_URL <canonical file>`.
4. Record result; clear maintenance flag.

Source is an existing `BackupRecord`'s canonical file. **Upload-a-file-to-restore**
(for a brand-new machine) is a fast-follow, not v1. Restore is the one truly
dangerous action — hence the safety backup, explicit typed confirmation, and
admin gate.

## 11. RBAC

- New `MODULE_KEYS` entry **`system_backup`** with `{ view, create, edit, delete }`.
- Default-granted to the **Admin** role only; screen + all endpoints enforce it.

## 12. UI (Settings → Backup & Restore, English)

Single page, top-to-bottom (matches the approved mockup):
1. **Automatic backup** (recommended, ON) — frequency (default *Twice a day*),
   times (13:00 / 20:00), retention (30 daily + 12 monthly).
2. **Manual backup** — "Back up now" + last-backup status line.
3. **Where to save** — folder destinations with friendly labels (External drive,
   Google Drive, OneDrive, or a custom folder), each a path input + enable toggle;
   plus Download. A "folder not found" inline warning per destination.
4. **History** — table with When / Type / Size / Saved-to / Status / Download +
   **Restore** (red, type-to-confirm modal).

Inline states: pg_dump-not-found warning; cloud-folder-missing prompt; per-row ⚠️
for partial destination failures.

## 13. Cross-Platform / Ops Notes

- pg_dump/pg_restore version should be ≥ the server's Postgres major version.
- Canonical backup dir must be writable and outside any web-served path.
- Backup files contain **all** data — treat as sensitive; download + history are admin-only.

## 14. Testing

- **Unit:** retention pruning (daily + monthly GFS logic), schedule-time parsing,
  destination-status aggregation (`SUCCESS`/`PARTIAL`/`FAILED`), missing-folder → `SKIPPED`.
- **Integration** (real Postgres, existing `npm run test:int` harness):
  create backup → file exists and `pg_restore --list` is valid; restore into a
  scratch DB → row counts match source; point a destination at a non-existent
  folder → `PARTIAL`.

## 15. Setup Needs / Open Items (resolved at implementation time)

- On the office server: install + sign into the **Google Drive / OneDrive desktop
  app** (once), and note each synced folder's path to enter in the Backup screen.
- Confirm the canonical backup directory location on the office server.
- Confirm Postgres (hence pg_dump/pg_restore) is installed on the office server.

## 16. Migration

- Prisma migration / `db push` for `BackupSettings` and `BackupRecord`, and
  seeding the new `system_backup` RBAC key.

## 17. Decisions Captured (from brainstorming)

- Deployment: **one office computer/server** (not Vercel/SaaS) → in-process
  scheduler + server-side dumps are valid.
- Capabilities: back up now **+** automatic schedule **+** restore **+** history (all four).
- Cadence: **twice a day, 13:00 & 20:00**; retention 30 daily + 12 monthly.
- Cloud: **synced folder** for both Google Drive and OneDrive (no OAuth/sign-in —
  reversed from an earlier OAuth idea because the credential setup was too
  technical for the owner). All destinations are just folders.
- Scope: **whole-database** dump (not per-org).
- Language: **English**.
