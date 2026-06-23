import { describe, it, expect } from 'vitest';
import {
  selectBackupsToPrune,
  timesToCronExpressions,
  aggregateDestinationStatus,
} from '../backup/retention';
import type { DestinationResult } from '../backup/types';
import { resolvePgToolPath } from '../backup/pg-tools';

const f = (name: string) => ({ fileName: name, createdAt: new Date(name.slice(15, 25)) });

describe('selectBackupsToPrune', () => {
  it('keeps the most recent N daily backups and deletes older same-day extras', () => {
    const files = [
      'msm_accounting_2026-06-23_1300.dump',
      'msm_accounting_2026-06-23_2000.dump',
      'msm_accounting_2026-06-22_1300.dump',
      'msm_accounting_2026-05-15_1300.dump',
    ].map(f);
    const prune = selectBackupsToPrune(files, { dailyCount: 2, monthlyCount: 12 });
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
