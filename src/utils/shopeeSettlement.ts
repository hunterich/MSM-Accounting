import * as XLSX from 'xlsx';
import { normalizeHeader } from './headerUtils';
import { isShopeeSettlement } from './marketplaceFormat';
import { SHOPEE_COLUMN_TO_KEY, SettlementFeeKey } from './settlementMapping';

export interface SettlementOrder {
  orderId: string;
  netReleased: number;
  charges: Partial<Record<SettlementFeeKey, number>>; // positive magnitudes
}
export interface SettlementParseResult {
  orders: SettlementOrder[];
  totalNetReleased: number;
  nonOrderRows: Array<{ orderId: string; type: string; amount: number }>;
}

export async function parseShopeeSettlement(file: File): Promise<SettlementParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!isShopeeSettlement(wb.SheetNames)) {
    throw new Error('This does not look like a TikTok settlement statement (expected Summary/Income/Adjustment sheets).');
  }
  const ws = wb.Sheets['Income'];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const headerIdx = rows.findIndex((r) => Array.isArray(r) && r.some((c) => normalizeHeader(String(c ?? '')) === 'orderid'));
  if (headerIdx < 0) throw new Error('Income sheet has no Order ID column.');
  const header = (rows[headerIdx] as unknown[]).map((c) => normalizeHeader(String(c ?? '')));
  const orderCol = header.indexOf('orderid');
  const netCol = header.indexOf(normalizeHeader('Total Released Amount (Rp)'));

  const orders: SettlementOrder[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const orderId = String(row[orderCol] ?? '').trim();
    if (!orderId || !/\d/.test(orderId)) continue;
    const charges: Partial<Record<SettlementFeeKey, number>> = {};
    header.forEach((h, col) => {
      const key = SHOPEE_COLUMN_TO_KEY[h];
      if (!key) return;
      const v = Number(row[col] ?? 0);
      if (!v) return;
      charges[key] = (charges[key] ?? 0) + Math.abs(v);
    });
    orders.push({ orderId, netReleased: netCol >= 0 ? Number(row[netCol] ?? 0) : 0, charges });
  }
  return { orders, totalNetReleased: orders.reduce((s, o) => s + o.netReleased, 0), nonOrderRows: [] };
}
