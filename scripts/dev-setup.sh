#!/usr/bin/env bash
# Idempotent dev environment bootstrap.
# Runs at Claude Code session start (see .claude/settings.json) and is safe to
# run by hand at any time. Goal: zero-touch "preview_start dev" / "preview_start backend".
#
# Solves the three recurring failures when starting a fresh git worktree:
#   1. .env is gitignored and missing in new worktrees -> backend Prisma fails
#   2. Postgres service is stopped after a reboot -> DB connections refused
#   3. .claude/launch.json missing the backend entry -> only frontend boots
#
# All steps are idempotent and silent on success. Errors are logged but do not
# block session start.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '[dev-setup] %s\n' "$*" >&2; }

# Resolve the main worktree path via git. In a linked worktree this returns the
# original repo (where untracked files like .env live). In the main worktree it
# returns itself, so the copy below is a no-op.
MAIN_REPO_ROOT="$(cd "$REPO_ROOT" && git worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{print $2; exit}')"
if [[ -z "${MAIN_REPO_ROOT:-}" ]]; then
  MAIN_REPO_ROOT="$REPO_ROOT"
fi

# 1. Ensure .env exists. Worktrees don't inherit untracked files, so copy from
#    the main worktree when missing.
if [[ ! -f "$REPO_ROOT/.env" ]]; then
  if [[ -f "$MAIN_REPO_ROOT/.env" && "$MAIN_REPO_ROOT" != "$REPO_ROOT" ]]; then
    cp "$MAIN_REPO_ROOT/.env" "$REPO_ROOT/.env"
    log ".env copied from main worktree"
  fi
fi

# 2. Ensure Postgres is running. Use brew services on macOS.
if command -v nc >/dev/null 2>&1; then
  if ! /usr/bin/nc -z localhost 5432 >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      brew services start postgresql@15 >/dev/null 2>&1 \
        && log "postgresql@15 started" \
        || log "WARN: failed to start postgresql@15"
    fi
  fi
fi

# 3. Ensure .claude/launch.json has both `dev` and `backend` entries. If the
#    file is missing or only has `dev`, rewrite it.
LAUNCH="$REPO_ROOT/.claude/launch.json"
mkdir -p "$REPO_ROOT/.claude"
needs_write=0
if [[ ! -f "$LAUNCH" ]]; then
  needs_write=1
elif ! grep -q '"name": "backend"' "$LAUNCH" 2>/dev/null; then
  needs_write=1
fi
if [[ "$needs_write" == "1" ]]; then
  cat > "$LAUNCH" <<'JSON'
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "dev",
      "runtimeExecutable": "/opt/homebrew/bin/node",
      "runtimeArgs": ["/opt/homebrew/bin/npm", "run", "dev"],
      "port": 5173,
      "autoPort": true
    },
    {
      "name": "backend",
      "runtimeExecutable": "/opt/homebrew/bin/node",
      "runtimeArgs": ["/opt/homebrew/bin/npm", "run", "backend:dev"],
      "port": 3000,
      "autoPort": false
    }
  ]
}
JSON
  log "launch.json refreshed (dev + backend)"
fi

exit 0
