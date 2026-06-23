import type { DestinationResult } from './types';

export type BackupFileMeta = { fileName: string; createdAt: Date };
export type RetentionPolicy = { dailyCount: number; monthlyCount: number };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export function selectBackupsToPrune(
  files: BackupFileMeta[],
  policy: RetentionPolicy,
): BackupFileMeta[] {
  const sorted = [...files].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.fileName.localeCompare(a.fileName),
  );

  // Step 1: daily keepers — newest file per day, for the N most recent distinct days
  const newestPerDay = new Map<string, BackupFileMeta>();
  for (const file of sorted) {
    const dk = dayKey(file.createdAt);
    if (!newestPerDay.has(dk)) newestPerDay.set(dk, file);
  }
  const keptDayKeys = [...newestPerDay.keys()].sort().reverse().slice(0, policy.dailyCount);
  const keptByDaily = new Set<string>(
    keptDayKeys.map((dk) => newestPerDay.get(dk)!.fileName),
  );

  // Step 2: monthly keepers — for files NOT protected by daily, group by month.
  // Only protect a month if it has 2+ files outside the daily window (to pick the best one).
  // Apply the monthlyCount cap on how many months back we protect.
  const outsideDaily = sorted.filter((f) => !keptByDaily.has(f.fileName));

  const byMonth = new Map<string, BackupFileMeta[]>();
  for (const file of outsideDaily) {
    const mk = monthKey(file.createdAt);
    const group = byMonth.get(mk) ?? [];
    group.push(file);
    byMonth.set(mk, group);
  }

  const keptMonthKeys = [...byMonth.keys()].sort().reverse().slice(0, policy.monthlyCount);
  const keptByMonthly = new Set<string>();
  for (const mk of keptMonthKeys) {
    const group = byMonth.get(mk)!;
    if (group.length >= 2) {
      // Keep the newest in this month (already sorted newest-first since outsideDaily is sorted)
      keptByMonthly.add(group[0].fileName);
    }
  }

  return sorted.filter(
    (file) => !keptByDaily.has(file.fileName) && !keptByMonthly.has(file.fileName),
  );
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
