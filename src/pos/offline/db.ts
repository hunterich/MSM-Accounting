import Dexie, { type Table } from 'dexie';
import type { CatalogRow, PosRegister } from '../hooks/usePos';
import type { SaleLineInput } from '@/lib/pos/pricing';

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

class PosDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  shiftState!: Table<ShiftStateRow, string>;
  catalog!: Table<CachedCatalog, string>;
  registers!: Table<CachedRegisters, string>;

  constructor() {
    super('pharmacy-pos');
    this.version(1).stores({
      outbox: 'localId, status, clientShiftId, createdAt',
      shiftState: 'key',
      catalog: 'key',
      registers: 'key',
    });
  }
}

export const db = new PosDB();
