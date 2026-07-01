import * as XLSX from 'xlsx';
import { normalizeHeader } from './headerUtils';
import { isTikTokSettlement } from './marketplaceFormat';
import { TIKTOK_COLUMN_TO_KEY, SettlementFeeKey } from './settlementMapping';
import type { SettlementParseResult } from './shopeeSettlement';

export async function parseTikTokSettlement(file: File): Promise<SettlementParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  if (!isTikTokSettlement(wb.SheetNames)) {
    throw new Error('This does not look like a TikTok settlement statement (expected a "Detail pesanan" sheet).');
  }
  const ws = wb.Sheets['Detail pesanan'];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const header = (rows[0] as unknown[]).map((c) => normalizeHeader(String(c ?? '')));
  const orderCol = header.indexOf('idpesananpenyesuaian');
  const typeCol = header.indexOf('jenistransaksi');
  const netCol = header.indexOf('jumlahpenyelesaianpembayaran');
  if (orderCol < 0 || typeCol < 0 || netCol < 0) throw new Error('TikTok Detail pesanan sheet is missing expected columns.');

  const orders: SettlementParseResult['orders'] = [];
  const nonOrderRows: SettlementParseResult['nonOrderRows'] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const orderId = String(row[orderCol] ?? '').trim();
    if (!orderId) continue;
    const type = String(row[typeCol] ?? '').trim();
    const net = Number(row[netCol] ?? 0);
    if (type !== 'Pesanan') { nonOrderRows.push({ orderId, type, amount: net }); continue; }
    const charges: Partial<Record<SettlementFeeKey, number>> = {};
    header.forEach((h, col) => {
      const key = TIKTOK_COLUMN_TO_KEY[h];
      if (!key) return;
      const v = Number(row[col] ?? 0);
      if (!v) return;
      charges[key] = (charges[key] ?? 0) + Math.abs(v);
    });
    orders.push({ orderId, netReleased: net, charges });
  }
  return { orders, totalNetReleased: orders.reduce((s, o) => s + o.netReleased, 0), nonOrderRows };
}
