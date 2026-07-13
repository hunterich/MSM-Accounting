/**
 * FNV-1a 32-bit hash for Postgres advisory-lock keys.
 *
 * Extracted verbatim from the FNV-1a in `lib/invoice-number.ts` /
 * `lib/api-utils.ts` so the several transaction-scoped serialization points
 * (invoice / JE numbering, per-item stock consumption) derive their lock keys
 * the SAME way instead of each re-implementing the hash.
 *
 * Take the returned key with `pg_advisory_xact_lock(<key>)` via `tx.$executeRaw`
 * INSIDE a `$transaction` — the lock is transaction-scoped and releases at
 * commit/rollback. ($executeRaw, not $queryRaw: pg_advisory_xact_lock returns
 * void, which $queryRaw cannot deserialize.)
 */
export const advisoryLockKey = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash || 1;
};
