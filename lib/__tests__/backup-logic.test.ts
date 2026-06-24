import { describe, it, expect } from 'vitest';
import {
  selectBackupsToPrune,
  timesToCronExpressions,
  aggregateDestinationStatus,
} from '../backup/retention';
import type { DestinationResult } from '../backup/types';
import { resolvePgToolPath } from '../backup/pg-tools';

describe('selectBackupsToPrune', () => {
  const file = (name: string, iso: string) => ({ fileName: name, createdAt: new Date(iso) });

  it('keeps the newest backup per day for the most recent N days; prunes older same-day extras and days beyond the window', () => {
    const files = [
      file('msm_accounting_2026-06-23_2000.dump', '2026-06-23T20:00:00Z'),
      file('msm_accounting_2026-06-23_1300.dump', '2026-06-23T13:00:00Z'),
      file('msm_accounting_2026-06-22_1300.dump', '2026-06-22T13:00:00Z'),
      file('msm_accounting_2026-06-21_1300.dump', '2026-06-21T13:00:00Z'),
    ];
    const prune = selectBackupsToPrune(files, { dailyCount: 2, monthlyCount: 0 }).map((p) => p.fileName);
    expect(prune).toContain('msm_accounting_2026-06-23_1300.dump');   // older same-day extra
    expect(prune).toContain('msm_accounting_2026-06-21_1300.dump');   // outside the 2-day window
    expect(prune).not.toContain('msm_accounting_2026-06-23_2000.dump'); // newest of newest day kept
    expect(prune).not.toContain('msm_accounting_2026-06-22_1300.dump'); // second day kept
  });

  it('keeps one monthly archive per month within monthlyCount months (even a lone old backup) and prunes the rest', () => {
    const files = [
      file('msm_accounting_2026-06-23_1300.dump', '2026-06-23T13:00:00Z'),
      file('msm_accounting_2026-05-31_2000.dump', '2026-05-31T20:00:00Z'),
      file('msm_accounting_2026-05-01_1300.dump', '2026-05-01T13:00:00Z'),
      file('msm_accounting_2026-03-10_0900.dump', '2026-03-10T09:00:00Z'),
    ];
    const prune = selectBackupsToPrune(files, { dailyCount: 1, monthlyCount: 12 }).map((p) => p.fileName);
    expect(prune).toContain('msm_accounting_2026-05-01_1300.dump');     // older May extra pruned
    expect(prune).not.toContain('msm_accounting_2026-05-31_2000.dump'); // newest May kept as monthly
    expect(prune).not.toContain('msm_accounting_2026-03-10_0900.dump'); // lone March archive kept
    expect(prune).not.toContain('msm_accounting_2026-06-23_1300.dump'); // recent daily kept
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
