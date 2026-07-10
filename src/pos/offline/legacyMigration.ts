import Dexie from 'dexie';
import { getActiveOrgId } from '@/src/lib/activeOrg';
import { PosDB, LEGACY_POS_DB_NAME, getPosDb } from './db';

export interface LegacyMigrationResult {
  /** Legacy data was copied into the per-company DB and the legacy DB deleted. */
  adopted: boolean;
  /** Legacy data exists but could not be safely adopted — left intact; warn the user. */
  strandedLegacy: boolean;
}

/**
 * Pure decision: may we adopt the legacy `pharmacy-pos` database into this
 * company's DB?
 *
 * Adopt ONLY when the legacy DB exists, the user belongs to exactly ONE company
 * (before multi-company existed every user had exactly one, so the data
 * provably belongs to it), and the target company DB has no queued sales and no
 * open shift (so nothing is overwritten). In every other case, skip — never
 * guess which company un-attributable sales belong to, and never clobber
 * existing data.
 */
export function shouldAdoptLegacy(input: {
  legacyExists: boolean;
  membershipCount: number;
  targetOutboxCount: number;
  targetHasShift: boolean;
}): boolean {
  const { legacyExists, membershipCount, targetOutboxCount, targetHasShift } = input;
  return legacyExists && membershipCount === 1 && targetOutboxCount === 0 && !targetHasShift;
}

/** Does the legacy, non-org-scoped `pharmacy-pos` database exist? */
async function legacyDbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  // Fast path: indexedDB.databases() is the reliable enumerator (Chromium/
  // WebKit). Fall through to the probe if it is missing or throws.
  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === LEGACY_POS_DB_NAME);
    } catch {
      /* fall through to the probe */
    }
  }
  return probeLegacyExists();
}

/**
 * Existence detection for browsers without indexedDB.databases() (e.g. Firefox).
 * Opening a database triggers `onupgradeneeded` ONLY when it did not previously
 * exist. If our probe creates it, we immediately delete the empty database we
 * just made so no phantom is left behind — otherwise we'd silently strand any
 * real legacy sales with no warning, violating the "never drop queued sales"
 * rule.
 */
function probeLegacyExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let existed = true;
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(LEGACY_POS_DB_NAME);
    } catch {
      resolve(false);
      return;
    }
    req.onupgradeneeded = () => { existed = false; };
    req.onsuccess = () => {
      req.result.close();
      // We just created it — remove the phantom empty DB.
      if (!existed) { try { indexedDB.deleteDatabase(LEGACY_POS_DB_NAME); } catch { /* best effort */ } }
      resolve(existed);
    };
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(existed);
  });
}

/** Copy the outbox + open shift from the legacy DB into the per-company DB. */
async function copyLegacyInto(target: PosDB): Promise<void> {
  const legacy = new PosDB(LEGACY_POS_DB_NAME);
  try {
    await legacy.open();
    const outboxRows = await legacy.outbox.toArray();
    const shift = await legacy.shiftState.get('current');
    await target.transaction('rw', target.outbox, target.shiftState, async () => {
      if (outboxRows.length) await target.outbox.bulkPut(outboxRows);
      if (shift) await target.shiftState.put(shift);
    });
  } finally {
    legacy.close();
  }
}

/**
 * One-time migration off the shared legacy `pharmacy-pos` database. Runs after
 * the active company is resolved and BEFORE the POS UI can write.
 *
 * - Adoptable (single company, empty target) → copy outbox + shift, then delete
 *   the legacy DB.
 * - Not adoptable but present (e.g. multiple companies) → leave the legacy DB
 *   intact and flag it so the UI can warn; silently dropping queued sales is
 *   unacceptable.
 * - catalog/registers are rebuildable caches and are never migrated.
 */
export async function migrateLegacyPosDb(membershipCount: number): Promise<LegacyMigrationResult> {
  const orgId = getActiveOrgId();
  if (!orgId) throw new Error('migrateLegacyPosDb called before an active company was resolved.');

  const legacyExists = await legacyDbExists();
  if (!legacyExists) return { adopted: false, strandedLegacy: false };

  const target = getPosDb();
  await target.open();
  const targetOutboxCount = await target.outbox.count();
  const targetHasShift = (await target.shiftState.get('current')) != null;

  if (shouldAdoptLegacy({ legacyExists, membershipCount, targetOutboxCount, targetHasShift })) {
    await copyLegacyInto(target);
    await Dexie.delete(LEGACY_POS_DB_NAME);
    return { adopted: true, strandedLegacy: false };
  }

  // Legacy data exists but we cannot safely attribute it to this company —
  // never delete it, and surface a warning so the operator can recover it.
  console.warn(
    `[POS] Found un-migrated offline data in the legacy "${LEGACY_POS_DB_NAME}" database that ` +
    'cannot be safely attributed to the active company (multiple companies, or the ' +
    'company already has offline data). It was left intact. If it holds unsynced sales, ' +
    'open POS in the correct single-company context or contact support.',
  );
  return { adopted: false, strandedLegacy: true };
}

// Memoise so the migration runs exactly once per page load, regardless of React
// StrictMode double-mounts or component remounts — concurrent runs could race
// on the IndexedDB delete.
let _migrationPromise: Promise<LegacyMigrationResult> | null = null;

export function runLegacyMigrationOnce(membershipCount: number): Promise<LegacyMigrationResult> {
  if (!_migrationPromise) _migrationPromise = migrateLegacyPosDb(membershipCount);
  return _migrationPromise;
}
