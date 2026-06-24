import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import type { BackupSettingsShape, DestinationResult } from './types';
import { resolvePgToolPath, assertPgToolAvailable, runPgDump, runPgRestore, scrubSecrets } from './pg-tools';
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

    await runPgDump({ toolPath: dumpTool, databaseUrl, outFile: canonicalFile });

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

    const policy = { dailyCount: settings.retentionDailyCount, monthlyCount: settings.retentionMonthlyCount };
    await pruneFolder(canonicalDir, policy);
    for (const dest of settings.folderDestinations.filter((d) => d.enabled)) {
      await pruneFolder(dest.path, policy).catch(() => {});
    }
    await pruneOldRecords();

    return { recordId: record.id, fileName, status };
  } catch (e) {
    const message = scrubSecrets(e instanceof Error ? e.message : String(e));
    await prisma.backupRecord.create({
      data: {
        type: opts.type,
        fileName: '(failed)',
        sizeBytes: 0,
        status: 'FAILED',
        destinations: [] as never,
        durationMs: Date.now() - started,
        triggeredByUserId: opts.triggeredByUserId ?? null,
        error: message,
      },
    });
    throw new Error(message);
  } finally {
    backupInProgress = false;
  }
}

async function pruneOldRecords(): Promise<void> {
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
  const restoreTool = resolvePgToolPath('pg_restore', { override: settings.pgToolsPathOverride });
  await assertPgToolAvailable(restoreTool);
  await runPgRestore({ toolPath: restoreTool, databaseUrl, inFile: filePath });

  return { safetyBackupId: safety.recordId, restoredFile: record.fileName };
}
