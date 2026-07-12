import Dexie, { type Table } from 'dexie';
import type { CatalogRow, PosRegister } from '../hooks/usePos';
import type { SaleLineInput } from '@/lib/pos/pricing';
import { getActiveOrgId } from '@/src/lib/activeOrg';

export type OutboxType = 'shift-open' | 'sale' | 'shift-close';
export type OutboxStatus = 'pending' | 'synced' | 'failed';

export interface ShiftOpenPayload { clientShiftId: string; registerId: string; openingFloat: number }
export interface SalePayload { clientSaleId: string; clientShiftId: string; registerId: string; shiftId?: string; lines: SaleLineInput[]; tenders: { method: 'CASH'; amount: number }[] }
export interface ShiftClosePayload { clientShiftId: string; shiftId?: string; countedCash: number }

export interface OutboxItem {
  localId: string;
  type: OutboxType;
  clientShiftId: string;
  payload: ShiftOpenPayload | SalePayload | ShiftClosePayload;
  status: OutboxStatus;
  error?: string;
  serverId?: string;
  createdAt: number;
}

export interface ShiftStateRow {
  key: 'current';
  clientShiftId: string;
  serverShiftId?: string;
  registerId: string;
  openingFloat: number;
  status: 'OPEN' | 'CLOSED';
}

export interface CachedCatalog { key: 'current'; rows: CatalogRow[]; fetchedAt: number }
export interface CachedRegisters { key: 'current'; rows: PosRegister[]; fetchedAt: number }

/** Legacy, pre-multi-company database name (one shared DB per browser profile). */
export const LEGACY_POS_DB_NAME = 'pharmacy-pos';

/**
 * Per-company IndexedDB name. Each company gets its own database so catalog,
 * registers, the open shift and — critically — the outbox of unsynced sales can
 * never bleed between companies in a single browser profile.
 */
export function posDbName(orgId: string): string {
  return `${LEGACY_POS_DB_NAME}:${orgId}`;
}

export class PosDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  shiftState!: Table<ShiftStateRow, string>;
  catalog!: Table<CachedCatalog, string>;
  registers!: Table<CachedRegisters, string>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({
      outbox: 'localId, status, clientShiftId, createdAt',
      shiftState: 'key',
      catalog: 'key',
      registers: 'key',
    });
  }
}

// The instance is created LAZILY — only once an active company is pinned for
// this tab — and never for a shared/default database. The POS shell pins the
// org (bootstrapActiveOrg + the company-selection gate) before rendering any
// component that touches the DB, so getPosDb() always resolves an org here.
let _db: PosDB | null = null;

/**
 * The per-company POS database. Throws (fails loud) if called before the active
 * company has been resolved for this tab — it must NEVER silently fall back to a
 * shared/default database, or a sale queued for one company could sync into
 * another. The org is pinned once per tab (switching does a hard reload), so the
 * first resolved instance is memoised.
 */
export function getPosDb(): PosDB {
  if (_db) return _db;
  const orgId = getActiveOrgId();
  if (!orgId) {
    throw new Error(
      'POS offline DB accessed before an active company was resolved. ' +
      'main.tsx must bootstrapActiveOrg() and the shell must pass the company gate before any db.* access.',
    );
  }
  _db = new PosDB(posDbName(orgId));
  return _db;
}

// `db` stays a stable, importable singleton for the six call sites, but every
// property access is forwarded to the lazily-built, org-scoped instance via a
// Proxy — so no Dexie connection is opened at import time, and the org must be
// resolved (getPosDb throws otherwise) before any real access. Methods are bound
// to the real instance so Dexie's `this` stays correct.
export const db: PosDB = new Proxy(Object.create(PosDB.prototype) as PosDB, {
  get(_target, prop) {
    const real = getPosDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
