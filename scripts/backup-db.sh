#!/usr/bin/env bash
#
# MSM Accounting — automatic database backup (engine) — VERSION-CONTROLLED COPY
# ----------------------------------------------------------------------------
# The LIVE copy that runs daily is installed OUTSIDE this repo at:
#     ~/Library/Application Support/MSM-Accounting-Backup/backup-db.sh
# (it must live outside ~/Documents so the macOS scheduler is allowed to run it).
#
# This repo copy is kept in sync as the canonical source. To (re)install on this
# or a new Mac:
#   1. mkdir -p "$HOME/Library/Application Support/MSM-Accounting-Backup/backups"
#   2. copy this file there as backup-db.sh ; chmod +x it
#   3. create a "config" file next to it (see scripts/RESTORE-GUIDE.md → Technical summary)
#   4. load the LaunchAgent ~/Library/LaunchAgents/com.msm.accounting.backup.plist
#
# What it does:
#   1) Always makes a LOCAL backup (needs no special permission).
#   2) Then copies that backup to OneDrive (cloud) and an external drive, if
#      Full Disk Access has been granted and the drive is connected.
#
set -uo pipefail   # NOT -e: one failed copy must not abort the whole backup

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/config"

DB_URL="${DATABASE_URL%%\?*}"          # strip Prisma's "?schema=public"
STAMP="$(date '+%Y-%m-%d_%H%M')"
FILE="msm_accounting_${STAMP}.dump"

LOCAL_DIR="$HERE/backups"
LOG="$LOCAL_DIR/backup.log"
mkdir -p "$LOCAL_DIR"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"; }

# --- 1) LOCAL backup (always works, no permissions needed) ---------------
if "$PG_BIN/pg_dump" --dbname="$DB_URL" --format=custom --file="$LOCAL_DIR/$FILE" 2>>"$LOG"; then
  log "OK    local backup  -> $FILE ($(du -h "$LOCAL_DIR/$FILE" | cut -f1))"
else
  log "ERROR pg_dump failed — NO backup made (is the database running?)"
  exit 1
fi

# --- 2) Cloud copy to OneDrive (needs Full Disk Access) ------------------
if [ -n "${CLOUD_BACKUP_DIR:-}" ]; then
  if mkdir -p "$CLOUD_BACKUP_DIR" 2>>"$LOG" && cp "$LOCAL_DIR/$FILE" "$CLOUD_BACKUP_DIR/$FILE" 2>>"$LOG"; then
    log "OK    cloud copy   -> OneDrive"
    find "$CLOUD_BACKUP_DIR" -name 'msm_accounting_*.dump' -type f -mtime "+$KEEP_DAYS" -delete 2>>"$LOG" || true
  else
    log "SKIP  cloud copy   -> OneDrive blocked (grant Full Disk Access — see RESTORE-GUIDE)"
  fi
fi

# --- 3) External-drive copy (if configured and connected) ----------------
if [ -n "${EXTERNAL_BACKUP_DIR:-}" ] && [ -d "$(dirname "$EXTERNAL_BACKUP_DIR")" ]; then
  if mkdir -p "$EXTERNAL_BACKUP_DIR" 2>>"$LOG" && cp "$LOCAL_DIR/$FILE" "$EXTERNAL_BACKUP_DIR/$FILE" 2>>"$LOG"; then
    log "OK    external copy -> $EXTERNAL_BACKUP_DIR"
    find "$EXTERNAL_BACKUP_DIR" -name 'msm_accounting_*.dump' -type f -mtime "+$KEEP_DAYS" -delete 2>>"$LOG" || true
  else
    log "SKIP  external copy -> not permitted or not connected"
  fi
fi

# --- 4) Tidy old LOCAL backups ------------------------------------------
find "$LOCAL_DIR" -name 'msm_accounting_*.dump' -type f -mtime "+$KEEP_DAYS" -delete 2>>"$LOG" || true
log "done  (keeping last $KEEP_DAYS days)"
