/**
 * Document numbers from the org's numbering settings — one formatter for the
 * form preview and the server allocator, so what the form shows is what gets
 * saved. (They used to differ: the form previewed `INV/2026/09/000009` from
 * Settings → Document numbering while the API always saved `INV-000009`.)
 *
 *   resetPeriod 'monthly' → PREFIX/YYYY/MM/SEQ   sequence restarts each month
 *   resetPeriod 'yearly'  → PREFIX/YYYY/SEQ      sequence restarts each year
 *   resetPeriod 'never'   → PREFIX-SEQ           one running sequence (the
 *                                                legacy shape, so existing
 *                                                `INV-000009` rows keep counting)
 *
 * `documentNumberScope` gives the allocator the LIKE prefix and the regex that
 * pick out the sequence within the current period, and `parseSequence` is the
 * same rule for a single number.
 */
import type { DocNumberingConfig } from './settings-config';

export interface DocumentNumberScope {
  /** SQL LIKE pattern selecting every number in the current period. */
  like: string;
  /** POSIX regex (Postgres `SUBSTRING(... FROM re)`) capturing the sequence. */
  regex: string;
}

const pad = (seq: number, width: number) => String(seq).padStart(width, '0');

function periodParts(date: Date): { yyyy: string; mm: string } {
  return {
    yyyy: String(date.getUTCFullYear()),
    mm: String(date.getUTCMonth() + 1).padStart(2, '0'),
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The period prefix (`INV/2026/09/`, `INV/2026/`, or `INV-`) for a date. */
export function documentNumberPrefix(cfg: DocNumberingConfig, date: Date): string {
  const { yyyy, mm } = periodParts(date);
  switch (cfg.resetPeriod) {
    case 'monthly':
      return `${cfg.prefix}/${yyyy}/${mm}/`;
    case 'yearly':
      return `${cfg.prefix}/${yyyy}/`;
    default:
      return `${cfg.prefix}-`;
  }
}

export function formatDocumentNumber(cfg: DocNumberingConfig, seq: number, date: Date): string {
  return `${documentNumberPrefix(cfg, date)}${pad(seq, cfg.seqLength)}`;
}

export function documentNumberScope(cfg: DocNumberingConfig, date: Date): DocumentNumberScope {
  const prefix = documentNumberPrefix(cfg, date);
  return {
    like: `${prefix}%`,
    regex: `^${escapeRegex(prefix)}(\\d+)$`,
  };
}

/** The sequence a number carries within `cfg`'s period for `date`, or null. */
export function parseSequence(cfg: DocNumberingConfig, date: Date, number: string): number | null {
  const m = new RegExp(documentNumberScope(cfg, date).regex).exec(number);
  return m ? parseInt(m[1], 10) : null;
}
