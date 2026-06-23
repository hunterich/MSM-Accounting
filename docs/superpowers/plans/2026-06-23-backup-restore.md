# Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app, server-side database Backup & Restore feature (automatic twice-daily + manual `pg_dump` backups to folder destinations incl. Google Drive/OneDrive synced folders, guarded admin-only restore, and backup history) under Settings.

**Architecture:** Business logic lives in `lib/backup/*` (pg_dump/pg_restore via `node:child_process`, folder destinations, retention, orchestration). Thin Next.js route handlers under `src/app/api/v1/backup/*` wrap the service using the existing `withHandler`/`requireOrg`/`ok`/`err` helpers and an `x-role-type === 'ADMIN'` gate. A `node-cron` scheduler is started once from `src/instrumentation.ts`. The frontend adds a `Backup & Restore` tab (`src/views/settings/BackupPanel.tsx`) wired through React Query hooks in `src/hooks/useBackup.ts`.

**Tech Stack:** Next.js 15 (App Router, `runtime = 'nodejs'`), Prisma 6 + PostgreSQL, `pg_dump`/`pg_restore`, `node-cron`, React 19 + Vite + React Query v5 + Zod. Tests: Vitest (`npm test` unit, `npm run test:int` integration against `<db>_test`).

**Reference spec:** `docs/superpowers/specs/2026-06-23-backup-restore-design.md`

---

## File Structure

**Create:**
- `lib/backup/types.ts` — shared TS types/enums (destination kinds, status, settings shape).
- `lib/backup/pg-tools.ts` — locate + run `pg_dump`/`pg_restore`.
- `lib/backup/retention.ts` — pure GFS retention selection + schedule-time parsing.
- `lib/backup/destinations.ts` — copy a dump to folder destinations; aggregate status.
- `lib/backup/backup-service.ts` — orchestration: settings, create, list, restore.
- `lib/backup/scheduler.ts` — node-cron init/reschedule from settings.
- `src/instrumentation.ts` — Next.js startup hook → start scheduler.
- `src/app/api/v1/backup/settings/route.ts` — GET/PUT settings.
- `src/app/api/v1/backup/run/route.ts` — POST manual backup.
- `src/app/api/v1/backup/history/route.ts` — GET history.
- `src/app/api/v1/backup/[id]/download/route.ts` — GET stream file.
- `src/app/api/v1/backup/[id]/restore/route.ts` — POST guarded restore.
- `src/hooks/useBackup.ts` — React Query hooks + download helper.
- `src/views/settings/BackupPanel.tsx` — the screen.
- `lib/__tests__/backup-logic.test.ts` — unit tests (retention/schedule/status/pg-tools resolve).
- `lib/__tests__/integration/backup.int.test.ts` — dump→restore roundtrip.

**Modify:**
- `prisma/schema.prisma` — add `SYSTEM_BACKUP` to `ModuleKey`; add `BackupSettings`, `BackupRecord` models + 3 enums.
- `prisma/seed.ts` — add `ModuleKey.SYSTEM_BACKUP` to `ALL_MODULE_KEYS`.
- `types/api.ts` — add `updateBackupSettingsInputSchema`, `restoreBackupInputSchema`.
- `src/stores/useAccessStore.ts` — add `system_backup` to `MODULE_KEYS` + `SIDEBAR_PERMISSION_MAP['Settings']`.
- `src/views/settings/Settings.tsx` — add the "Backup & Restore" menu item + render `<BackupPanel />`.
- `package.json` — add `node-cron` (+ `@types/node-cron`).
- `.env.example` — document optional `BACKUP_DIR`.
- `.gitignore` — ignore `data/backups`.

---

## Task 1: Data model, RBAC key, and seed

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add the new enums and models to the schema**

Append to `prisma/schema.prisma` (near the other enums at the bottom for the enums; models can go after the existing models):

```prisma
enum BackupFrequency {
  DAILY
  TWICE_DAILY
  WEEKLY
}

enum BackupType {
  AUTO
  MANUAL
  PRE_RESTORE_SAFETY
}

enum BackupStatus {
  SUCCESS
  PARTIAL
  FAILED
}

// System-level (not org-scoped): a whole-database backup spans all organizations.
model BackupSettings {
  id                  String          @id @default("singleton")
  enabled             Boolean         @default(true)
  frequency           BackupFrequency @default(TWICE_DAILY)
  times               Json            @default("[\"13:00\",\"20:00\"]")
  retentionDailyCount Int             @default(30)
  retentionMonthlyCount Int           @default(12)
  canonicalDir        String?
  folderDestinations  Json            @default("[]")
  downloadEnabled     Boolean         @default(true)
  pgToolsPathOverride String?
  updatedAt           DateTime        @updatedAt
}

model BackupRecord {
  id               String       @id @default(cuid())
  createdAt        DateTime     @default(now())
  type             BackupType
  fileName         String
  sizeBytes        Int          @default(0)
  status           BackupStatus
  destinations     Json         @default("[]")
  durationMs       Int          @default(0)
  triggeredByUserId String?
  error            String?

  @@index([createdAt])
}
```

- [ ] **Step 2: Add `SYSTEM_BACKUP` to the `ModuleKey` enum**

In `prisma/schema.prisma`, find `enum ModuleKey {` and add `SYSTEM_BACKUP` as the last value before the closing brace:

```prisma
enum ModuleKey {
  // ... existing values ...
  SETTINGS
  SYSTEM_BACKUP
}
```

- [ ] **Step 3: Seed the new permission**

In `prisma/seed.ts`, find the `ALL_MODULE_KEYS` array and add the new key as the last entry:

```typescript
const ALL_MODULE_KEYS: ModuleKey[] = [
  // ... existing ...
  ModuleKey.SETTINGS,
  ModuleKey.SYSTEM_BACKUP,
];
```

- [ ] **Step 4: Push schema to the dev DB and regenerate the client**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema." and "Generated Prisma Client".

- [ ] **Step 5: Re-seed so the Admin role gets the new permission**

Run: `npm run db:seed`
Expected: completes without error.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts
git commit -m "feat(backup): add BackupSettings/BackupRecord models + SYSTEM_BACKUP permission"
```

---

## Task 2: Shared types

**Files:**
- Create: `lib/backup/types.ts`

- [ ] **Step 1: Create the shared types module**

```typescript
// lib/backup/types.ts
export type FolderDestinationConfig = {
  label: string;   // friendly: "External drive", "Google Drive", "OneDrive", custom
  path: string;    // absolute folder path on the server
  enabled: boolean;
};

export type DestinationResultStatus = 'OK' | 'SKIPPED' | 'FAILED';

export type DestinationResult = {
  label: string;
  path: string;
  status: DestinationResultStatus;
  error?: string;
};

export type BackupSettingsShape = {
  enabled: boolean;
  frequency: 'DAILY' | 'TWICE_DAILY' | 'WEEKLY';
  times: string[];               // "HH:MM"
  retentionDailyCount: number;
  retentionMonthlyCount: number;
  canonicalDir: string | null;
  folderDestinations: FolderDestinationConfig[];
  downloadEnabled: boolean;
  pgToolsPathOverride: string | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/backup/types.ts
git commit -m "feat(backup): shared backup types"
```

---

## Task 3: Retention + schedule logic (pure, TDD)

**Files:**
- Create: `lib/backup/retention.ts`
- Test: `lib/__tests__/backup-logic.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/__tests__/backup-logic.test.ts
import { describe, it, expect } from 'vitest';
import {
  selectBackupsToPrune,
  timesToCronExpressions,
  aggregateDestinationStatus,
} from '../backup/retention';
import type { DestinationResult } from '../backup/types';

const f = (name: string) => ({ fileName: name, createdAt: new Date(name.slice(15, 25)) });

describe('selectBackupsToPrune', () => {
  it('keeps the most recent N daily backups and deletes older same-day extras', () => {
    const files = [
      'msm_accounting_2026-06-23_1300.dump',
      'msm_accounting_2026-06-23_2000.dump',
      'msm_accounting_2026-06-22_1300.dump',
      'msm_accounting_2026-05-15_1300.dump', // older than dailyCount window
    ].map(f);
    const prune = selectBackupsToPrune(files, { dailyCount: 2, monthlyCount: 12 });
    // June 23 (2 files, newest day) + June 22 kept as daily(2)? dailyCount=2 distinct days kept.
    expect(prune.map((p) => p.fileName)).toContain('msm_accounting_2026-05-15_1300.dump');
    expect(prune.map((p) => p.fileName)).not.toContain('msm_accounting_2026-06-23_2000.dump');
  });

  it('keeps one monthly backup per month within monthlyCount months', () => {
    const files = [
      'msm_accounting_2026-06-23_1300.dump',
      'msm_accounting_2026-05-31_2000.dump',
      'msm_accounting_2026-05-01_1300.dump',
    ].map(f);
    const prune = selectBackupsToPrune(files, { dailyCount: 1, monthlyCount: 12 });
    // Newest May kept as the May monthly; the older May 1 pruned.
    expect(prune.map((p) => p.fileName)).toContain('msm_accounting_2026-05-01_1300.dump');
    expect(prune.map((p) => p.fileName)).not.toContain('msm_accounting_2026-05-31_2000.dump');
  });
});

describe('timesToCronExpressions', () => {
  it('maps HH:MM strings to daily cron expressions', () => {
    expect(timesToCronExpressions(['13:00', '20:30'])).toEqual(['0 13 * * *', '30 20 * * *']);
  });
  it('ignores malformed entries', () => {
    expect(timesToCronExpressions(['13:00', 'oops', '25:99'])).toEqual(['0 13 * * *']);
  });
});

describe('aggregateDestinationStatus', () => {
  const r = (status: DestinationResult['status']): DestinationResult => ({ label: 'x', path: '/x', status });
  it('SUCCESS when all OK', () => {
    expect(aggregateDestinationStatus([r('OK'), r('OK')])).toBe('SUCCESS');
  });
  it('PARTIAL when some skipped/failed but at least one OK', () => {
    expect(aggregateDestinationStatus([r('OK'), r('FAILED')])).toBe('PARTIAL');
    expect(aggregateDestinationStatus([r('OK'), r('SKIPPED')])).toBe('PARTIAL');
  });
  it('SUCCESS when there are no destinations (canonical only)', () => {
    expect(aggregateDestinationStatus([])).toBe('SUCCESS');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/__tests__/backup-logic.test.ts`
Expected: FAIL — cannot resolve `../backup/retention`.

- [ ] **Step 3: Implement `lib/backup/retention.ts`**

```typescript
// lib/backup/retention.ts
import type { DestinationResult } from './types';

export type BackupFileMeta = { fileName: string; createdAt: Date };
export type RetentionPolicy = { dailyCount: number; monthlyCount: number };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);          // YYYY-MM-DD
const monthKey = (d: Date) => d.toISOString().slice(0, 7);          // YYYY-MM

/**
 * GFS-style selection of which backups to DELETE.
 * Keep: newest backup of each of the most recent `dailyCount` days,
 * PLUS newest backup of each of the most recent `monthlyCount` months.
 * Everything else is pruned.
 */
export function selectBackupsToPrune(
  files: BackupFileMeta[],
  policy: RetentionPolicy,
): BackupFileMeta[] {
  const sorted = [...files].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const newestPerDay = new Map<string, BackupFileMeta>();
  const newestPerMonth = new Map<string, BackupFileMeta>();
  for (const file of sorted) {
    const dk = dayKey(file.createdAt);
    const mk = monthKey(file.createdAt);
    if (!newestPerDay.has(dk)) newestPerDay.set(dk, file);
    if (!newestPerMonth.has(mk)) newestPerMonth.set(mk, file);
  }

  const keptDays = [...newestPerDay.keys()].sort().reverse().slice(0, policy.dailyCount);
  const keptMonths = [...newestPerMonth.keys()].sort().reverse().slice(0, policy.monthlyCount);

  const keep = new Set<string>();
  for (const dk of keptDays) keep.add(newestPerDay.get(dk)!.fileName);
  for (const mk of keptMonths) keep.add(newestPerMonth.get(mk)!.fileName);

  return sorted.filter((file) => !keep.has(file.fileName));
}

/** Map ["HH:MM"] → daily cron expressions ["M H * * *"], skipping malformed entries. */
export function timesToCronExpressions(times: string[]): string[] {
  const out: string[] = [];
  for (const t of times) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(t).trim());
    if (!m) continue;
    out.push(`${Number(m[2])} ${Number(m[1])} * * *`);
  }
  return out;
}

export function aggregateDestinationStatus(
  results: DestinationResult[],
): 'SUCCESS' | 'PARTIAL' | 'FAILED' {
  if (results.length === 0) return 'SUCCESS';
  const oks = results.filter((r) => r.status === 'OK').length;
  if (oks === results.length) return 'SUCCESS';
  if (oks === 0) return 'FAILED';
  return 'PARTIAL';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/__tests__/backup-logic.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/backup/retention.ts lib/__tests__/backup-logic.test.ts
git commit -m "feat(backup): retention + schedule logic (TDD)"
```

---

## Task 4: pg-tools (locate + run pg_dump/pg_restore)

**Files:**
- Create: `lib/backup/pg-tools.ts`
- Test: append to `lib/__tests__/backup-logic.test.ts`

- [ ] **Step 1: Write the failing test for binary resolution**

Append to `lib/__tests__/backup-logic.test.ts`:

```typescript
import { resolvePgToolPath } from '../backup/pg-tools';

describe('resolvePgToolPath', () => {
  it('uses the override directory when the binary exists there', () => {
    const exists = (p: string) => p === '/custom/bin/pg_dump';
    expect(resolvePgToolPath('pg_dump', { override: '/custom/bin', fileExists: exists }))
      .toBe('/custom/bin/pg_dump');
  });
  it('falls back to the bare command name when no override/dir matches (rely on PATH)', () => {
    expect(resolvePgToolPath('pg_restore', { override: null, fileExists: () => false, searchDirs: [] }))
      .toBe('pg_restore');
  });
  it('finds the binary in a provided search dir', () => {
    const exists = (p: string) => p === '/opt/pg/bin/pg_dump';
    expect(resolvePgToolPath('pg_dump', { override: null, fileExists: exists, searchDirs: ['/opt/pg/bin'] }))
      .toBe('/opt/pg/bin/pg_dump');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/__tests__/backup-logic.test.ts`
Expected: FAIL — cannot resolve `../backup/pg-tools`.

- [ ] **Step 3: Implement `lib/backup/pg-tools.ts`**

```typescript
// lib/backup/pg-tools.ts
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCb);

type ResolveOpts = {
  override?: string | null;
  fileExists?: (p: string) => boolean;
  searchDirs?: string[];
};

function defaultSearchDirs(): string[] {
  // Best-effort common install bin dirs across OSes. PATH is tried first by callers.
  if (process.platform === 'win32') {
    return ['C:\\Program Files\\PostgreSQL\\16\\bin', 'C:\\Program Files\\PostgreSQL\\15\\bin'];
  }
  if (process.platform === 'darwin') {
    return ['/opt/homebrew/opt/postgresql@16/bin', '/opt/homebrew/opt/postgresql@15/bin', '/usr/local/bin'];
  }
  return ['/usr/bin', '/usr/local/bin'];
}

/** Resolve an absolute path (or bare command name to use via PATH) for pg_dump/pg_restore. */
export function resolvePgToolPath(
  tool: 'pg_dump' | 'pg_restore',
  opts: ResolveOpts = {},
): string {
  const fileExists = opts.fileExists ?? existsSync;
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;

  if (opts.override) {
    const candidate = path.join(opts.override, exe);
    if (fileExists(candidate)) return candidate;
  }
  const dirs = opts.searchDirs ?? defaultSearchDirs();
  for (const dir of dirs) {
    const candidate = path.join(dir, exe);
    if (fileExists(candidate)) return candidate;
  }
  return tool; // rely on PATH
}

export class PgToolsError extends Error {}

/** Confirm the tool is runnable; throws PgToolsError with guidance if not. */
export async function assertPgToolAvailable(toolPath: string): Promise<string> {
  try {
    const { stdout } = await execFile(toolPath, ['--version']);
    return stdout.trim();
  } catch {
    throw new PgToolsError(
      `Could not run "${toolPath}". Install PostgreSQL client tools or set the tools path in Backup settings.`,
    );
  }
}

/** Strip Prisma's "?schema=public" so libpq accepts the URL. */
export function toLibpqUrl(databaseUrl: string): string {
  const q = databaseUrl.indexOf('?');
  return q === -1 ? databaseUrl : databaseUrl.slice(0, q);
}

export async function runPgDump(args: {
  toolPath: string;
  databaseUrl: string;
  outFile: string;
}): Promise<void> {
  await execFile(args.toolPath, [
    '--dbname', toLibpqUrl(args.databaseUrl),
    '--format=custom',
    '--file', args.outFile,
  ], { maxBuffer: 64 * 1024 * 1024 });
}

export async function runPgRestore(args: {
  toolPath: string;
  databaseUrl: string;
  inFile: string;
}): Promise<void> {
  await execFile(args.toolPath, [
    '--clean', '--if-exists', '--no-owner',
    '--dbname', toLibpqUrl(args.databaseUrl),
    args.inFile,
  ], { maxBuffer: 64 * 1024 * 1024 });
}
```

- [ ] **Step 4: Run to verify the resolve tests pass**

Run: `npm test -- lib/__tests__/backup-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/pg-tools.ts lib/__tests__/backup-logic.test.ts
git commit -m "feat(backup): pg_dump/pg_restore tooling (resolve + run)"
```

---

## Task 5: Folder destinations (copy + prune)

**Files:**
- Create: `lib/backup/destinations.ts`

- [ ] **Step 1: Implement the destination handler**

```typescript
// lib/backup/destinations.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DestinationResult, FolderDestinationConfig } from './types';
import { selectBackupsToPrune, type BackupFileMeta } from './retention';

const DUMP_RE = /^msm_accounting_.*\.dump$/;

/** Copy a dump file into one folder destination. Missing folder → SKIPPED (not fatal). */
export async function copyToFolder(
  srcFile: string,
  dest: FolderDestinationConfig,
): Promise<DestinationResult> {
  try {
    // If the folder's parent doesn't exist (e.g. cloud app not installed / drive unplugged), skip.
    const parent = path.dirname(dest.path);
    try {
      await fs.access(parent);
    } catch {
      return { label: dest.label, path: dest.path, status: 'SKIPPED', error: 'Folder not available' };
    }
    await fs.mkdir(dest.path, { recursive: true });
    await fs.copyFile(srcFile, path.join(dest.path, path.basename(srcFile)));
    return { label: dest.label, path: dest.path, status: 'OK' };
  } catch (e) {
    return { label: dest.label, path: dest.path, status: 'FAILED', error: e instanceof Error ? e.message : String(e) };
  }
}

/** List dump files in a folder with their createdAt (from mtime). */
export async function listDumpFiles(dir: string): Promise<BackupFileMeta[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const metas: BackupFileMeta[] = [];
  for (const name of names) {
    if (!DUMP_RE.test(name)) continue;
    const stat = await fs.stat(path.join(dir, name));
    metas.push({ fileName: name, createdAt: stat.mtime });
  }
  return metas;
}

/** Apply retention to a single folder (canonical or destination). */
export async function pruneFolder(
  dir: string,
  policy: { dailyCount: number; monthlyCount: number },
): Promise<void> {
  const files = await listDumpFiles(dir);
  const toPrune = selectBackupsToPrune(files, policy);
  for (const file of toPrune) {
    await fs.rm(path.join(dir, file.fileName), { force: true });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `lib/backup/destinations.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/backup/destinations.ts
git commit -m "feat(backup): folder destination copy + prune"
```

---

## Task 6: Backup service — settings + create

**Files:**
- Create: `lib/backup/backup-service.ts`

- [ ] **Step 1: Implement settings accessors + createBackup**

```typescript
// lib/backup/backup-service.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import type { BackupSettingsShape, DestinationResult } from './types';
import { resolvePgToolPath, assertPgToolAvailable, runPgDump } from './pg-tools';
import { copyToFolder, pruneFolder } from './destinations';
import { aggregateDestinationStatus } from './retention';

const SINGLETON_ID = 'singleton';

export function defaultCanonicalDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups');
}

export async function getSettings(): Promise<BackupSettingsShape & { canonicalDirResolved: string }> {
  const row = await prisma.backupSettings.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return {
    enabled: row.enabled,
    frequency: row.frequency,
    times: row.times as string[],
    retentionDailyCount: row.retentionDailyCount,
    retentionMonthlyCount: row.retentionMonthlyCount,
    canonicalDir: row.canonicalDir,
    folderDestinations: (row.folderDestinations as BackupSettingsShape['folderDestinations']) ?? [],
    downloadEnabled: row.downloadEnabled,
    pgToolsPathOverride: row.pgToolsPathOverride,
    canonicalDirResolved: row.canonicalDir || defaultCanonicalDir(),
  };
}

export async function updateSettings(input: Partial<BackupSettingsShape>): Promise<void> {
  await prisma.backupSettings.upsert({
    where: { id: SINGLETON_ID },
    update: { ...input } as never,
    create: { id: SINGLETON_ID, ...input } as never,
  });
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let backupInProgress = false;

export type CreateBackupResult = { recordId: string; fileName: string; status: string };

export async function createBackup(opts: {
  type: 'AUTO' | 'MANUAL' | 'PRE_RESTORE_SAFETY';
  triggeredByUserId?: string | null;
}): Promise<CreateBackupResult> {
  if (backupInProgress) throw new Error('A backup is already running. Please try again shortly.');
  backupInProgress = true;
  const started = Date.now();
  try {
    const settings = await getSettings();
    const canonicalDir = settings.canonicalDirResolved;
    await fs.mkdir(canonicalDir, { recursive: true });

    const fileName = `msm_accounting_${stamp(new Date())}.dump`;
    const canonicalFile = path.join(canonicalDir, fileName);

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not set on the server.');

    const dumpTool = resolvePgToolPath('pg_dump', { override: settings.pgToolsPathOverride });
    await assertPgToolAvailable(dumpTool);

    // 1) Canonical dump (authoritative).
    await runPgDump({ toolPath: dumpTool, databaseUrl, outFile: canonicalFile });

    // 2) Copy to each enabled destination folder.
    const results: DestinationResult[] = [];
    for (const dest of settings.folderDestinations.filter((d) => d.enabled)) {
      results.push(await copyToFolder(canonicalFile, dest));
    }

    const status = aggregateDestinationStatus(results);
    const sizeBytes = (await fs.stat(canonicalFile)).size;

    const record = await prisma.backupRecord.create({
      data: {
        type: opts.type,
        fileName,
        sizeBytes,
        status,
        destinations: results as never,
        durationMs: Date.now() - started,
        triggeredByUserId: opts.triggeredByUserId ?? null,
      },
      select: { id: true },
    });

    // 3) Retention: canonical + each destination folder + DB rows.
    const policy = { dailyCount: settings.retentionDailyCount, monthlyCount: settings.retentionMonthlyCount };
    await pruneFolder(canonicalDir, policy);
    for (const dest of settings.folderDestinations.filter((d) => d.enabled)) {
      await pruneFolder(dest.path, policy).catch(() => {});
    }
    await pruneOldRecords();

    return { recordId: record.id, fileName, status };
  } catch (e) {
    await prisma.backupRecord.create({
      data: {
        type: opts.type,
        fileName: '(failed)',
        sizeBytes: 0,
        status: 'FAILED',
        destinations: [] as never,
        durationMs: Date.now() - started,
        triggeredByUserId: opts.triggeredByUserId ?? null,
        error: e instanceof Error ? e.message : String(e),
      },
    });
    throw e;
  } finally {
    backupInProgress = false;
  }
}

async function pruneOldRecords(): Promise<void> {
  // Keep history rows for the last 400 backups (well above retention file counts).
  const old = await prisma.backupRecord.findMany({
    orderBy: { createdAt: 'desc' },
    skip: 400,
    select: { id: true },
  });
  if (old.length) {
    await prisma.backupRecord.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }
}

export async function listBackups(page = 1, limit = 20) {
  const [data, total] = await Promise.all([
    prisma.backupRecord.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.backupRecord.count(),
  ]);
  return { data, total, page, limit };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `lib/backup/backup-service.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/backup/backup-service.ts
git commit -m "feat(backup): backup service (settings + create + list)"
```

---

## Task 7: API route — settings (GET/PUT) + Zod

**Files:**
- Modify: `types/api.ts`
- Create: `src/app/api/v1/backup/settings/route.ts`

- [ ] **Step 1: Add Zod schemas to `types/api.ts`**

Append:

```typescript
const folderDestinationSchema = z.object({
  label: z.string().trim().min(1),
  path: z.string().trim().min(1),
  enabled: z.boolean(),
});

export const updateBackupSettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(['DAILY', 'TWICE_DAILY', 'WEEKLY']).optional(),
  times: z.array(z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/)).optional(),
  retentionDailyCount: z.number().int().min(1).max(365).optional(),
  retentionMonthlyCount: z.number().int().min(0).max(120).optional(),
  canonicalDir: z.string().trim().min(1).nullable().optional(),
  folderDestinations: z.array(folderDestinationSchema).optional(),
  downloadEnabled: z.boolean().optional(),
  pgToolsPathOverride: z.string().trim().min(1).nullable().optional(),
});

export const restoreBackupInputSchema = z.object({
  confirm: z.literal('RESTORE'),
});
```

- [ ] **Step 2: Create the settings route**

```typescript
// src/app/api/v1/backup/settings/route.ts
import { NextRequest } from 'next/server';
import { ok, err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { getSettings, updateSettings } from '@/lib/backup/backup-service';
import { resolvePgToolPath, assertPgToolAvailable } from '@/lib/backup/pg-tools';
import { updateBackupSettingsInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function requireAdmin(req: NextRequest): string | null {
  if (req.headers.get('x-role-type') !== 'ADMIN') return 'Forbidden: ADMIN role required';
  return null;
}

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return err(forbidden, 403);

  const settings = await getSettings();
  let pgToolsOk = true;
  let pgToolsMessage = '';
  try {
    const tool = resolvePgToolPath('pg_dump', { override: settings.pgToolsPathOverride });
    pgToolsMessage = await assertPgToolAvailable(tool);
  } catch (e) {
    pgToolsOk = false;
    pgToolsMessage = e instanceof Error ? e.message : String(e);
  }
  return ok({ ...settings, pgToolsOk, pgToolsMessage });
});

export const PUT = withHandler(async function PUT(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return err(forbidden, 403);

  const body = await req.json();
  const parsed = updateBackupSettingsInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid backup settings', 400);

  await updateSettings(parsed.data);

  // Reschedule cron jobs to reflect new times/frequency/enabled.
  const { rescheduleBackups } = await import('@/lib/backup/scheduler');
  await rescheduleBackups();

  return ok(await getSettings());
});
```

> NOTE: `rescheduleBackups` is created in Task 10. Until then this import will fail at runtime only when PUT is called; it does not break typecheck/build because it is a dynamic import. Do Task 10 before manually exercising PUT.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (dynamic import is not type-resolved until Task 10; if typecheck complains, proceed to Task 10 then re-run).

- [ ] **Step 4: Commit**

```bash
git add types/api.ts src/app/api/v1/backup/settings/route.ts
git commit -m "feat(backup): settings API (GET/PUT) + zod schemas"
```

---

## Task 8: API route — run (manual backup)

**Files:**
- Create: `src/app/api/v1/backup/run/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/v1/backup/run/route.ts
import { NextRequest } from 'next/server';
import { ok, err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { createBackup } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const userId = req.headers.get('x-user-id');
  const result = await createBackup({ type: 'MANUAL', triggeredByUserId: userId });
  return ok(result, 201);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/backup/run/route.ts
git commit -m "feat(backup): manual run API"
```

---

## Task 9: API routes — history + download

**Files:**
- Create: `src/app/api/v1/backup/history/route.ts`
- Create: `src/app/api/v1/backup/[id]/download/route.ts`

- [ ] **Step 1: Create the history route**

```typescript
// src/app/api/v1/backup/history/route.ts
import { NextRequest } from 'next/server';
import { err, listResponse, withHandler, parsePaginationParams } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { listBackups } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const { page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const { data, total } = await listBackups(page, limit);
  return listResponse(data, total, page, limit);
});
```

- [ ] **Step 2: Create the download route**

```typescript
// src/app/api/v1/backup/[id]/download/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { withCors } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/backup/backup-service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const { id } = await params;
  const record = await prisma.backupRecord.findUnique({ where: { id } });
  if (!record || record.fileName === '(failed)') return err('Backup file not found', 404);

  const settings = await getSettings();
  const filePath = path.join(settings.canonicalDirResolved, record.fileName);
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return err('Backup file is no longer on disk', 410);
  }
  return withCors(new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${record.fileName}"`,
      'x-filename': record.fileName,
    },
  }));
});
```

> If `withCors` is not exported from `@/lib/cors`, open `lib/cors.ts`, confirm the export name, and adjust the import. The Explore notes confirm `withCors` and `corsPreflightResponse` both live there.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/backup/history/route.ts "src/app/api/v1/backup/[id]/download/route.ts"
git commit -m "feat(backup): history + download APIs"
```

---

## Task 10: Scheduler + Next.js instrumentation

**Files:**
- Modify: `package.json` (add dependency)
- Create: `lib/backup/scheduler.ts`
- Create: `src/instrumentation.ts`

- [ ] **Step 1: Install node-cron**

Run: `npm install node-cron@^3.0.3 && npm install -D @types/node-cron`
Expected: packages added to `package.json`.

- [ ] **Step 2: Implement the scheduler**

```typescript
// lib/backup/scheduler.ts
import cron, { type ScheduledTask } from 'node-cron';
import { getSettings, createBackup } from './backup-service';
import { timesToCronExpressions } from './retention';

let tasks: ScheduledTask[] = [];

function stopAll() {
  for (const t of tasks) t.stop();
  tasks = [];
}

export async function rescheduleBackups(): Promise<void> {
  stopAll();
  const settings = await getSettings();
  if (!settings.enabled) return;

  const times = settings.frequency === 'DAILY'
    ? settings.times.slice(0, 1)
    : settings.frequency === 'WEEKLY'
      ? settings.times.slice(0, 1) // weekly handled via day-of-week below
      : settings.times;

  const exprs = settings.frequency === 'WEEKLY'
    ? timesToCronExpressions(times).map((e) => e.replace('* * *', '* * 1')) // Mondays
    : timesToCronExpressions(times);

  for (const expr of exprs) {
    tasks.push(cron.schedule(expr, () => {
      void createBackup({ type: 'AUTO' }).catch((e) => {
        console.error('[backup] scheduled backup failed:', e);
      });
    }));
  }
  console.log(`[backup] scheduled ${tasks.length} job(s): ${exprs.join(', ') || '(none)'}`);
}

export async function initBackupScheduler(): Promise<void> {
  try {
    await rescheduleBackups();
  } catch (e) {
    console.error('[backup] failed to init scheduler:', e);
  }
}
```

- [ ] **Step 3: Create the Next.js instrumentation hook**

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initBackupScheduler } = await import('@/lib/backup/scheduler');
    await initBackupScheduler();
  }
}
```

- [ ] **Step 4: Verify the backend boots and schedules**

Run: `npm run backend:dev`
Expected: server starts and logs `[backup] scheduled N job(s): ...` once. Stop the server with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/backup/scheduler.ts src/instrumentation.ts
git commit -m "feat(backup): node-cron scheduler started via instrumentation"
```

---

## Task 11: Restore (service + guarded API)

**Files:**
- Modify: `lib/backup/backup-service.ts`
- Create: `src/app/api/v1/backup/[id]/restore/route.ts`

- [ ] **Step 1: Add `restoreBackup` to the service**

Append to `lib/backup/backup-service.ts`:

```typescript
import { resolvePgToolPath as resolveTool, assertPgToolAvailable as assertTool, runPgRestore } from './pg-tools';

export async function restoreBackup(opts: {
  recordId: string;
  triggeredByUserId?: string | null;
}): Promise<{ safetyBackupId: string; restoredFile: string }> {
  const record = await prisma.backupRecord.findUnique({ where: { id: opts.recordId } });
  if (!record || record.fileName === '(failed)') throw new Error('Backup not found');

  const settings = await getSettings();
  const filePath = path.join(settings.canonicalDirResolved, record.fileName);
  await fs.access(filePath); // throws if missing

  // 1) Safety backup BEFORE we touch the live DB.
  const safety = await createBackup({ type: 'PRE_RESTORE_SAFETY', triggeredByUserId: opts.triggeredByUserId });

  // 2) Restore.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set on the server.');
  const restoreTool = resolveTool('pg_restore', { override: settings.pgToolsPathOverride });
  await assertTool(restoreTool);
  await runPgRestore({ toolPath: restoreTool, databaseUrl, inFile: filePath });

  return { safetyBackupId: safety.recordId, restoredFile: record.fileName };
}
```

- [ ] **Step 2: Create the restore route**

```typescript
// src/app/api/v1/backup/[id]/restore/route.ts
import { NextRequest } from 'next/server';
import { ok, err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { restoreBackup } from '@/lib/backup/backup-service';
import { restoreBackupInputSchema } from '@/types/api';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const body = await req.json().catch(() => ({}));
  const parsed = restoreBackupInputSchema.safeParse(body);
  if (!parsed.success) return err('You must type RESTORE to confirm.', 400);

  const { id } = await params;
  const userId = req.headers.get('x-user-id');
  const result = await restoreBackup({ recordId: id, triggeredByUserId: userId });
  return ok(result);
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/backup/backup-service.ts "src/app/api/v1/backup/[id]/restore/route.ts"
git commit -m "feat(backup): guarded restore (safety backup + pg_restore)"
```

---

## Task 12: Frontend React Query hooks

**Files:**
- Create: `src/hooks/useBackup.ts`

- [ ] **Step 1: Create the hooks + download helper**

```typescript
// src/hooks/useBackup.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';

export type FolderDestination = { label: string; path: string; enabled: boolean };
export type BackupSettings = {
  enabled: boolean;
  frequency: 'DAILY' | 'TWICE_DAILY' | 'WEEKLY';
  times: string[];
  retentionDailyCount: number;
  retentionMonthlyCount: number;
  canonicalDir: string | null;
  folderDestinations: FolderDestination[];
  downloadEnabled: boolean;
  pgToolsPathOverride: string | null;
  pgToolsOk: boolean;
  pgToolsMessage: string;
};
export type BackupRecord = {
  id: string;
  createdAt: string;
  type: 'AUTO' | 'MANUAL' | 'PRE_RESTORE_SAFETY';
  fileName: string;
  sizeBytes: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  destinations: { label: string; path: string; status: string; error?: string }[];
  error?: string | null;
};

export const BACKUP_KEYS = {
  settings: ['backup', 'settings'] as const,
  history: (page: number) => ['backup', 'history', page] as const,
};

export function useBackupSettings() {
  return useQuery({
    queryKey: BACKUP_KEYS.settings,
    queryFn: () => api.get<BackupSettings>('/api/v1/backup/settings'),
  });
}

export function useUpdateBackupSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<BackupSettings>) => api.put<BackupSettings>('/api/v1/backup/settings', body),
    onSuccess: (data) => qc.setQueryData(BACKUP_KEYS.settings, data),
  });
}

export function useBackupHistory(page = 1) {
  return useQuery({
    queryKey: BACKUP_KEYS.history(page),
    queryFn: () => api.get<{ data: BackupRecord[]; total: number }>('/api/v1/backup/history', { page }),
  });
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/v1/backup/run', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup', 'history'] }),
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/backup/${id}/restore`, { confirm: 'RESTORE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup', 'history'] }),
  });
}

/** Stream a backup file to the browser (sends auth cookie + x-org-id like apiClient). */
export async function downloadBackupFile(id: string, fileName: string): Promise<void> {
  const base = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL || 'http://localhost:3000';
  const orgId = useAuthStore.getState().org?.id;
  const res = await fetch(`${base}/api/v1/backup/${id}/download`, {
    credentials: 'include',
    headers: orgId ? { 'x-org-id': orgId } : {},
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

> Confirm `useAuthStore` exposes `org?.id` (Explore notes: `apiClient` reads `useAuthStore.getState().org?.id`). If the property differs, mirror exactly what `src/api/apiClient.ts` uses.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBackup.ts
git commit -m "feat(backup): react-query hooks + download helper"
```

---

## Task 13: Frontend Backup panel + Settings wiring + RBAC key

**Files:**
- Create: `src/views/settings/BackupPanel.tsx`
- Modify: `src/views/settings/Settings.tsx`
- Modify: `src/stores/useAccessStore.ts`

- [ ] **Step 1: Add the RBAC key to the access store**

In `src/stores/useAccessStore.ts`, add to `MODULE_KEYS` (after `settings`):

```typescript
    settings:      { label: 'Application Settings',   group: 'Settings' },
    system_backup: { label: 'Backup & Restore',       group: 'Settings' },
```

And extend the Settings group in `SIDEBAR_PERMISSION_MAP`:

```typescript
    'Settings':            ['settings', 'system_backup'],
```

- [ ] **Step 2: Create `BackupPanel.tsx`**

```tsx
// src/views/settings/BackupPanel.tsx
import { useState } from 'react';
import { DatabaseBackup, Download, RotateCcw, Plus, Trash2 } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import {
  useBackupSettings, useUpdateBackupSettings, useBackupHistory,
  useRunBackup, useRestoreBackup, downloadBackupFile,
  type FolderDestination, type BackupRecord,
} from '../../hooks/useBackup';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupPanel() {
  const { data: settings } = useBackupSettings();
  const updateSettings = useUpdateBackupSettings();
  const runBackup = useRunBackup();
  const restore = useRestoreBackup();
  const { data: history } = useBackupHistory(1);

  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [confirmText, setConfirmText] = useState('');

  if (!settings) return <Card title="Backup & Restore"><p>Loading…</p></Card>;

  const setDest = (idx: number, patch: Partial<FolderDestination>) => {
    const next = settings.folderDestinations.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    updateSettings.mutate({ folderDestinations: next });
  };
  const addDest = () => updateSettings.mutate({
    folderDestinations: [...settings.folderDestinations, { label: 'New folder', path: '', enabled: true }],
  });
  const removeDest = (idx: number) => updateSettings.mutate({
    folderDestinations: settings.folderDestinations.filter((_, i) => i !== idx),
  });

  return (
    <div className="space-y-4">
      {!settings.pgToolsOk && (
        <Card title="⚠️ Backup tools not found">
          <p className="text-sm">{settings.pgToolsMessage}</p>
        </Card>
      )}

      {/* ① Automatic */}
      <Card title="Automatic backup (recommended)">
        <label className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={settings.enabled}
            onChange={(e) => updateSettings.mutate({ enabled: e.target.checked })} />
          <span>Back up automatically</span>
        </label>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span>How often:</span>
          <select value={settings.frequency}
            onChange={(e) => updateSettings.mutate({ frequency: e.target.value as 'DAILY' | 'TWICE_DAILY' | 'WEEKLY' })}
            className="h-9 px-2 rounded-md border">
            <option value="TWICE_DAILY">Twice a day</option>
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Every week</option>
          </select>
          <span>at {settings.times.join(' & ')}</span>
        </div>
        <p className="text-xs opacity-70 mt-2">
          Keeps the last {settings.retentionDailyCount} daily backups + a monthly copy for {settings.retentionMonthlyCount} months.
        </p>
      </Card>

      {/* ② Manual */}
      <Card title="Manual backup">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm opacity-80">Run an extra backup now — e.g. before month-end close or an update.</p>
          <Button text="Back up now" variant="primary" icon={<DatabaseBackup size={16} />}
            loading={runBackup.isPending} onClick={() => runBackup.mutate()} />
        </div>
        {runBackup.isError && <p className="text-sm text-red-600 mt-2">{(runBackup.error as Error).message}</p>}
      </Card>

      {/* ③ Destinations */}
      <Card title="Where to save" actions={<Button text="Add folder" variant="secondary" icon={<Plus size={16} />} onClick={addDest} />}>
        {settings.folderDestinations.length === 0 && (
          <p className="text-sm opacity-70">No folders yet. Add your external drive folder, Google Drive folder, or OneDrive folder.</p>
        )}
        {settings.folderDestinations.map((d, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={d.enabled} onChange={(e) => setDest(i, { enabled: e.target.checked })} />
            <Input value={d.label} onChange={(e) => setDest(i, { label: e.target.value })} placeholder="Label" />
            <Input value={d.path} onChange={(e) => setDest(i, { path: e.target.value })} placeholder="Folder path (e.g. G:\\My Drive\\MSM-Backups)" />
            <Button text="" variant="ghost" icon={<Trash2 size={16} />} onClick={() => removeDest(i)} />
          </div>
        ))}
      </Card>

      {/* ④ History */}
      <Card title="Backup history">
        <table className="w-full text-sm">
          <thead><tr className="text-left opacity-60">
            <th className="py-2">When</th><th>Type</th><th>Size</th><th>Status</th><th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {(history?.data ?? []).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2">{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.type === 'AUTO' ? 'Auto' : r.type === 'MANUAL' ? 'Manual' : 'Safety'}</td>
                <td>{formatBytes(r.sizeBytes)}</td>
                <td><StatusTag status={r.status} /></td>
                <td className="text-right whitespace-nowrap">
                  {r.fileName !== '(failed)' && (
                    <>
                      <Button text="Download" variant="ghost" icon={<Download size={14} />}
                        onClick={() => downloadBackupFile(r.id, r.fileName)} />
                      <Button text="Restore" variant="danger" icon={<RotateCcw size={14} />}
                        onClick={() => { setRestoreTarget(r); setConfirmText(''); }} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Restore confirmation */}
      <Modal isOpen={!!restoreTarget} onClose={() => setRestoreTarget(null)} title="Restore this backup?" size="md">
        <p className="text-sm mb-3">
          This <strong>replaces all current data</strong> with the backup from{' '}
          {restoreTarget && new Date(restoreTarget.createdAt).toLocaleString()}. A safety backup is taken first.
          Make sure all other staff are logged out.
        </p>
        <p className="text-sm mb-2">Type <strong>RESTORE</strong> to confirm:</p>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <div className="flex justify-end gap-2 mt-4">
          <Button text="Cancel" variant="secondary" onClick={() => setRestoreTarget(null)} />
          <Button text="Restore" variant="danger" disabled={confirmText !== 'RESTORE' || restore.isPending}
            loading={restore.isPending}
            onClick={async () => {
              if (!restoreTarget) return;
              await restore.mutateAsync(restoreTarget.id);
              setRestoreTarget(null);
              window.alert('Restore complete.');
            }} />
        </div>
        {restore.isError && <p className="text-sm text-red-600 mt-2">{(restore.error as Error).message}</p>}
      </Modal>
    </div>
  );
}
```

> Component prop names (`Button.text/variant/icon/loading`, `Modal.isOpen/onClose/title/size`, `Card.title/actions`, `Input.value/onChange`, `StatusTag.status`) match the Explore notes. If `Card` uses a different actions prop name, adjust. If `StatusTag` needs lowercase, pass `r.status.toLowerCase()`.

- [ ] **Step 3: Wire the tab into `Settings.tsx`**

Add the import at the top:

```tsx
import BackupPanel from './BackupPanel';
import { DatabaseBackup } from 'lucide-react';
```

Add a menu item to the `menuItems` array (after `migration` / near the end):

```tsx
    { id: 'backup', label: 'Backup & Restore', icon: DatabaseBackup },
```

Add the conditional render in the content area (alongside the other `{activeTab === ...}` blocks):

```tsx
{activeTab === 'backup' && <BackupPanel />}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Fix any prop-name mismatches the typechecker surfaces against the real UI components.)

- [ ] **Step 5: Verify in the browser**

Start backend + frontend (`npm run backend:dev` and `npm run dev`), log in as Admin, open Settings → Backup & Restore. Confirm: the panel renders, "Back up now" creates a row in history, Download fetches a file, and the Restore modal requires typing RESTORE.

- [ ] **Step 6: Commit**

```bash
git add src/views/settings/BackupPanel.tsx src/views/settings/Settings.tsx src/stores/useAccessStore.ts
git commit -m "feat(backup): Settings Backup & Restore panel + RBAC key"
```

---

## Task 14: Integration test — dump→restore roundtrip

**Files:**
- Create: `lib/__tests__/integration/backup.int.test.ts`

- [ ] **Step 1: Ensure the test DB exists**

Run: `npm run test:int:setup`
Expected: `<db>_test` exists with the schema pushed.

- [ ] **Step 2: Write the integration test**

```typescript
// lib/__tests__/integration/backup.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { resolvePgToolPath, assertPgToolAvailable, runPgDump, runPgRestore } from '../../backup/pg-tools';

afterAll(async () => { await disconnect(); });

function testDbUrl(): string {
  // harness forces the DB name to end in _test; mirror its resolution.
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
  const url = new URL(base);
  const db = url.pathname.replace(/^\//, '');
  if (!db.endsWith('_test')) url.pathname = `/${db}_test`;
  return url.toString();
}

describe('backup: dump → restore roundtrip', () => {
  it('pg_dump produces a restorable file; restore brings the data back', async () => {
    const dumpTool = resolvePgToolPath('pg_dump');
    await assertPgToolAvailable(dumpTool); // skips meaningfully if tools missing

    const org = await createTestOrg();
    const before = await prisma.organization.count();
    expect(before).toBeGreaterThan(0);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msm-backup-'));
    const file = path.join(dir, 'msm_accounting_test.dump');
    const url = testDbUrl();

    await runPgDump({ toolPath: dumpTool, databaseUrl: url, outFile: file });
    const stat = await fs.stat(file);
    expect(stat.size).toBeGreaterThan(0);

    // Restore into the SAME test DB (idempotent clean+restore) and confirm data survives.
    const restoreTool = resolvePgToolPath('pg_restore');
    await runPgRestore({ toolPath: restoreTool, databaseUrl: url, inFile: file });

    const after = await prisma.organization.count();
    expect(after).toBe(before);

    await fs.rm(dir, { recursive: true, force: true });
    await cleanupOrg(org.orgId);
  });
});
```

> This restores into the test DB itself (`--clean --if-exists` makes it idempotent), proving the file is restorable without needing a second database. If `pg_dump`/`pg_restore` are not installed in CI, `assertPgToolAvailable` throws a clear message — gate or skip there as needed.

- [ ] **Step 3: Run the integration test**

Run: `npm run test:int -- lib/__tests__/integration/backup.int.test.ts`
Expected: PASS (dump file > 0 bytes; org count unchanged after restore).

- [ ] **Step 4: Commit**

```bash
git add lib/__tests__/integration/backup.int.test.ts
git commit -m "test(backup): dump→restore roundtrip integration test"
```

---

## Task 15: Docs, env, gitignore, and final verification

**Files:**
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Document the optional env var**

Append to `.env.example`:

```
# Optional: where database backups are written on the server.
# Defaults to <project>/data/backups. Point destinations (external drive,
# Google Drive / OneDrive synced folders) are configured in the app's
# Settings → Backup & Restore screen.
BACKUP_DIR=""
```

- [ ] **Step 2: Ignore the local backups directory**

Append to `.gitignore`:

```
# Local database backups
data/backups/
```

- [ ] **Step 3: Full verification pass**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS (includes `lib/__tests__/backup-logic.test.ts`).

Run: `npm run test:int -- lib/__tests__/integration/backup.int.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .env.example .gitignore
git commit -m "chore(backup): document BACKUP_DIR + ignore local backups"
```

---

## Done criteria

- Admin sees **Settings → Backup & Restore** with automatic schedule (default twice-daily), manual "Back up now", folder destinations, and history.
- A manual backup creates a `.dump` in the canonical dir + each enabled folder, recorded in history.
- Download streams the file; Restore (type-"RESTORE") takes a safety backup then restores.
- Scheduler logs scheduled jobs on backend boot; changing settings reschedules.
- `npm test`, `npm run typecheck`, and the integration test all pass.

## Notes for the implementer

- **Non-admins:** every backup route returns 403 unless `x-role-type === 'ADMIN'`; the panel still appears inside Settings, so also hide the tab if you later add finer gating via `hasPermission('system_backup','view')`.
- **Restore safety:** restore replaces the live DB; the safety backup runs first. Document "log everyone off before restoring" in the UI copy (already in the modal).
- **Cross-platform:** `resolvePgToolPath` covers common Windows/macOS/Linux install dirs and falls back to PATH; the Settings `pgToolsPathOverride` is the escape hatch.
- **Scheduler requires a long-running server** (`next start` / `next dev`) — valid for the office-server deployment; not for serverless.
