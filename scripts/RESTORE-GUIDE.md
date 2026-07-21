# Your accounting backups — how they work (plain-language guide)

You do **not** need to be technical to read this. Keep it for the day something
goes wrong.

## What gets backed up

A complete, compressed snapshot of the whole accounting database
(`msm_accounting`) — every customer, invoice, bill, journal entry, item, etc.
Each backup is one file named like `msm_accounting_2026-06-23_1048.dump`
(the date and time it was taken).

## When it runs

Automatically, **once a day at about 1:00 PM**. If the Mac is asleep or off at
that time, macOS runs the backup as soon as the Mac next wakes. You don't have
to do anything.

## Where backups are saved (in priority order)

1. **On this Mac (always works):**
   `~/Library/Application Support/MSM-Accounting-Backup/backups/`
   This copy is guaranteed — it needs no special permission.

2. **OneDrive (cloud, off-site):**
   `OneDrive - Murni Sukses Mandiri / MSM-Accounting-Backups`
   Syncs off the Mac automatically, so it survives even if the Mac dies.

3. **External drive (if plugged in and set up):** same folder name on the drive.

The system keeps the **last 30 days** in each place and deletes older ones.

## ⚙️ One-time setup to make cloud + external fully reliable

macOS protects OneDrive and external drives from background apps. The daily
backup can already *write* to OneDrive, but to let it manage files there
reliably (and to use an external drive), grant it permission **once**:

1. Apple menu  → **System Settings**.
2. **Privacy & Security** → **Full Disk Access**.
3. Click the **＋** button (unlock with Touch ID / password if asked).
4. In the window that opens, press **⌘ + Shift + G**, type **`/bin`**, press Return.
5. Select **`bash`** and click **Open**.
6. Make sure the switch next to **bash** is turned **ON** (blue).
7. Done — no restart needed. The next daily backup will have full access.

## How to check it's working

Open the backups folder (either the OneDrive one or the local one above). You
should see a recent `.dump` file with today's or yesterday's date. There's also
a `backup.log` — each line marked `OK` is a successful backup.

## ▶️ Make an extra backup right now

Open **Terminal** and paste:

    bash "$HOME/Library/Application Support/MSM-Accounting-Backup/backup-db.sh"

## ⏪ How to RESTORE (recover your data)

> ⚠️ Restoring **replaces** the current database with the backup's contents.
> If unsure, ask a technical person — but the steps are simple.

1. Pick the backup file you want (usually the newest) from any backups folder.
2. Open **Terminal** and run, replacing the file name with your chosen one:

       PGBIN=/opt/homebrew/opt/postgresql@15/bin
       "$PGBIN/pg_restore" -h localhost -U postgres -d msm_accounting --clean --if-exists \
         "$HOME/Library/Application Support/MSM-Accounting-Backup/backups/msm_accounting_YYYY-MM-DD_HHMM.dump"

Your data is now back to the moment that backup was taken.

### Restoring onto a brand-new / replacement Mac

Install PostgreSQL 15, create an empty database, then restore:

    /opt/homebrew/opt/postgresql@15/bin/createdb -h localhost -U postgres msm_accounting
    # ...then run the pg_restore command above.

## Adding your external drive later

When your external drive is connected, find its name (it appears on the desktop
/ in Finder under "Locations"). Then edit this one line in
`~/Library/Application Support/MSM-Accounting-Backup/config`:

    EXTERNAL_BACKUP_DIR="/Volumes/YOUR DRIVE NAME/MSM-Accounting-Backups"

(or just tell Claude the drive's name and it will do it for you.)

## If a backup ever fails

Open `backup.log`. A failed run is marked `ERROR` with the reason just above it.
The most common cause is the database not running at backup time — the next
day's run usually succeeds on its own. A `local backup OK` line means your data
is safe even if the cloud/external line says `SKIP`.

## Technical summary (for an IT helper)

- Engine: `~/Library/Application Support/MSM-Accounting-Backup/backup-db.sh`
- Config: `…/MSM-Accounting-Backup/config` (passwordless local `pg_dump`)
- Schedule: LaunchAgent `~/Library/LaunchAgents/com.msm.accounting.backup.plist`
  (`com.msm.accounting.backup`, daily `StartCalendarInterval` 13:00)
- Format: `pg_dump --format=custom` → restore with `pg_restore`
- Full Disk Access on `/bin/bash` is what unblocks OneDrive cleanup + external drives.
