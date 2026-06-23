import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DestinationResult, FolderDestinationConfig } from './types';
import { selectBackupsToPrune, type BackupFileMeta } from './retention';

const DUMP_RE = /^msm_accounting_.*\.dump$/;

export async function copyToFolder(
  srcFile: string,
  dest: FolderDestinationConfig,
): Promise<DestinationResult> {
  try {
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
