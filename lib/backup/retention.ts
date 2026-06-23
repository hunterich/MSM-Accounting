import type { DestinationResult } from './types';

export type BackupFileMeta = { fileName: string; createdAt: Date };
export type RetentionPolicy = { dailyCount: number; monthlyCount: number };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);   // YYYY-MM-DD
const monthKey = (d: Date) => d.toISOString().slice(0, 7);  // YYYY-MM

/**
 * GFS-style selection of which backups to DELETE.
 * KEEP a backup if it is the newest of one of the most recent `dailyCount` days,
 * OR the newest of one of the most recent `monthlyCount` months. A lone older
 * backup that is still within the monthly window is KEPT as that month's archive
 * (retention errs toward keeping data). Everything else is pruned.
 */
export function selectBackupsToPrune(
  files: BackupFileMeta[],
  policy: RetentionPolicy,
): BackupFileMeta[] {
  // Newest-first; tiebreak on fileName desc for deterministic same-instant ordering.
  const sorted = [...files].sort((a, b) => {
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    if (t !== 0) return t;
    return a.fileName < b.fileName ? 1 : a.fileName > b.fileName ? -1 : 0;
  });

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

  const keep = new Set<BackupFileMeta>();
  for (const dk of keptDays) keep.add(newestPerDay.get(dk)!);
  for (const mk of keptMonths) keep.add(newestPerMonth.get(mk)!);

  return sorted.filter((file) => !keep.has(file));
}

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
