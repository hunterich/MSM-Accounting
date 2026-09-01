/**
 * Transaction-date restriction — Accurate's "Pembatasan Tanggal Transaksi".
 *
 * The period lock (`assertPeriodOpen`) answers "is this month signed off?".
 * This answers a different question: "is this date plausible at all?". A
 * document dated three years back, or eight months forward, is almost always a
 * typo — and by the time anyone notices, it is sitting in a period nobody
 * thinks to look at.
 *
 * The window is relative to today, not to a fixed range, so it needs no
 * maintenance: `daysBefore: 60` means "nothing older than 60 days", and it
 * still means that next month. `null` on either side is no limit there.
 *
 * Two modes, because tightening this on a working team is not a flag-flip:
 *
 *   WARN  — the form says so before saving; the server allows it. Use this
 *           while people learn the rule.
 *   BLOCK — the server refuses with a 422, the same way the period lock does.
 *
 * Who can post outside it: whoever holds SETTINGS/edit. That is the same right
 * that closes a period and the same right that edits this policy — someone who
 * can widen the window to anything is not meaningfully restrained by it, so a
 * separate permission would be decoration. Everything automated (depreciation,
 * recurring bills, payroll, settlement import) posts as nobody and is held to
 * the window, which is what you want: those paths post dated today.
 */
import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

type Db = Prisma.TransactionClient | { organization: { findUnique: (args: unknown) => Promise<unknown> } };

export type TransactionDateMode = 'WARN' | 'BLOCK';

export interface TransactionDatePolicy {
  enabled: boolean;
  mode: TransactionDateMode;
  /** Days a document may be backdated. Null = no limit. */
  daysBefore: number | null;
  /** Days a document may be post-dated. Null = no limit. */
  daysAfter: number | null;
}

export const DEFAULT_TRANSACTION_DATE_POLICY: TransactionDatePolicy = {
  enabled: false,
  mode: 'WARN',
  daysBefore: null,
  daysAfter: null,
};

/** A whole number of days, or null. Anything else (negative, NaN, "30") is null. */
function parseDayLimit(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Read a stored policy defensively. The column is JSON written by an API, so it
 * can hold anything an older version of this app wrote — an unreadable value
 * must disable the restriction, never invent one.
 */
export function parseTransactionDatePolicy(raw: unknown): TransactionDatePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_TRANSACTION_DATE_POLICY;
  }
  const o = raw as Record<string, unknown>;
  const mode: TransactionDateMode = o.mode === 'BLOCK' ? 'BLOCK' : 'WARN';
  const daysBefore = parseDayLimit(o.daysBefore);
  const daysAfter = parseDayLimit(o.daysAfter);
  // A policy with neither bound restricts nothing; call that disabled so the
  // UI and the guard agree rather than reporting an active-but-empty rule.
  const enabled = o.enabled === true && (daysBefore !== null || daysAfter !== null);
  return { enabled, mode, daysBefore, daysAfter };
}

/** Midnight UTC of the day `date` falls on — the grain the window works at. */
function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

const MS_PER_DAY = 86_400_000;

export interface TransactionDateVerdict {
  /** 'ok' when inside the window, or when the policy restricts nothing. */
  status: 'ok' | 'outside';
  /** Which bound was crossed, and by how much. Null when inside. */
  direction: 'before' | 'after' | null;
  /** Whole days past the bound. 0 when inside. */
  daysOutside: number;
  /** Ready to render, or to throw. Null when inside. */
  message: string | null;
}

const INSIDE: TransactionDateVerdict = {
  status: 'ok',
  direction: null,
  daysOutside: 0,
  message: null,
};

/**
 * Compare a document date against the window.
 *
 * Whole days, both bounds inclusive: with `daysBefore: 30`, a document dated
 * exactly 30 days ago is allowed and 31 days ago is not. Comparison is at UTC
 * day grain, matching how every date field in this app is stored and how
 * `assertPeriodOpen` resolves a period.
 */
export function evaluateTransactionDate(
  policy: TransactionDatePolicy,
  date: Date,
  now: Date = new Date(),
): TransactionDateVerdict {
  if (!policy.enabled) return INSIDE;
  if (Number.isNaN(date.getTime())) return INSIDE;

  const offsetDays = Math.round((startOfUtcDay(date) - startOfUtcDay(now)) / MS_PER_DAY);

  if (policy.daysBefore !== null && offsetDays < -policy.daysBefore) {
    const daysOutside = -offsetDays - policy.daysBefore;
    return {
      status: 'outside',
      direction: 'before',
      daysOutside,
      message:
        `This date is ${-offsetDays} days in the past. Documents may be backdated at most ` +
        `${policy.daysBefore} day${policy.daysBefore === 1 ? '' : 's'}.`,
    };
  }

  if (policy.daysAfter !== null && offsetDays > policy.daysAfter) {
    const daysOutside = offsetDays - policy.daysAfter;
    return {
      status: 'outside',
      direction: 'after',
      daysOutside,
      message:
        `This date is ${offsetDays} days in the future. Documents may be post-dated at most ` +
        `${policy.daysAfter} day${policy.daysAfter === 1 ? '' : 's'}.`,
    };
  }

  return INSIDE;
}

export async function loadTransactionDatePolicy(
  db: Db,
  organizationId: string,
): Promise<TransactionDatePolicy> {
  const org = (await (db as Prisma.TransactionClient).organization.findUnique({
    where: { id: organizationId },
    select: { transactionDatePolicy: true },
  })) as { transactionDatePolicy: unknown } | null;
  return parseTransactionDatePolicy(org?.transactionDatePolicy);
}

export interface TransactionDateGuardOptions {
  /**
   * The caller holds SETTINGS/edit, so the window does not apply to them.
   * Absent means "no", which is the right default: every path that cannot
   * prove otherwise is held to the rule.
   */
  overrideDateRestriction?: boolean;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * Throws ApiError(422) when `date` is outside the window and the policy is set
 * to BLOCK. WARN never throws — the form has already said so, and the point of
 * WARN is that the save still lands.
 */
export async function assertTransactionDateAllowed(
  db: Db,
  organizationId: string,
  date: Date,
  opts: TransactionDateGuardOptions = {},
): Promise<void> {
  if (opts.overrideDateRestriction) return;

  const policy = await loadTransactionDatePolicy(db, organizationId);
  if (!policy.enabled || policy.mode !== 'BLOCK') return;

  const verdict = evaluateTransactionDate(policy, date, opts.now);
  if (verdict.status === 'outside' && verdict.message) {
    throw new ApiError(verdict.message, 422);
  }
}
